/**
 * Naver CLOVA Studio "Chat Completions v3" → OpenAI response translator.
 *
 * CLOVA v3 streams as SSE with **named events**:
 *
 * ```
 * id: <uuid>
 * event: token
 * data: {"message":{"role":"assistant","content":"안"},"finishReason":null,...}
 *
 * id: <uuid>
 * event: result
 * data: {"message":{"role":"assistant","content":"안녕"},"finishReason":"stop",
 *        "usage":{"promptTokens":20,"completionTokens":5,"totalTokens":25}}
 * ```
 *
 * The trap this translator exists to defuse: **`event: token` carries an
 * incremental delta, but `event: result` carries the COMPLETE text.** Concatenating
 * both duplicates the whole answer at the end of the stream. So the result event
 * is treated as a terminal snapshot — it contributes usage + finish_reason only,
 * never content (the same "final snapshot bypasses the rolling delta buffer"
 * rule already documented for the Responses API in AGENTS.md).
 *
 * Upstream failures arrive either as an HTTP error (handled by the executor) or
 * as an in-stream payload whose `status.code` is not `20000`; the latter is
 * surfaced through `state.upstreamError` so stream.ts fails the request out and
 * combo fallback can run, mirroring the Gemini translator.
 *
 * Docs: https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3
 */
import { register } from "../registry.ts";
import { FORMATS } from "../formats.ts";

/** CLOVA's success status code (a string, not an HTTP number). */
const CLOVA_STATUS_OK = "20000";

/** Map a CLOVA `finishReason` onto the OpenAI vocabulary. */
function mapFinishReason(reason: unknown): string {
  switch (String(reason || "")) {
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

/**
 * Map a CLOVA string status code onto an HTTP status for error surfacing.
 * Codes are 5-digit strings: `2xxxx` success, `4xxxx` client, `5xxxx` server.
 */
function httpStatusFromClovaCode(code: unknown): number {
  const first = String(code || "").charAt(0);
  if (first === "4") return 400;
  return 502;
}

/**
 * Parse one raw SSE frame into `{ event, data }`.
 * CLOVA emits `id:` / `event:` / `data:` lines per frame.
 */
export function parseClovaSseFrame(raw: string): { event: string; data: unknown } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let event = "";
  let dataLine = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLine = trimmed.slice(5).trim();
    }
  }

  if (!dataLine) return null;

  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

/**
 * Build one OpenAI delta chunk.
 *
 * `field` selects the delta key: `"content"` for the visible answer and
 * `"reasoning_content"` for CLOVA's `thinkingContent` (HCX-007). Reasoning and
 * answer arrive as separate token events, so they must not be merged into one
 * delta or clients that split the two streams will mis-place the text.
 */
function deltaChunk(state, content: string, field = "content"): Record<string, unknown> {
  const chunk: Record<string, unknown> = {
    id: state.responseId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "clova",
    choices: [
      {
        index: 0,
        delta: {
          ...(state.chunkIndex === 0 ? { role: "assistant" } : {}),
          [field]: content,
        },
        finish_reason: null,
      },
    ],
  };
  state.chunkIndex++;
  return chunk;
}

function terminalChunk(state, finishReason: string): Record<string, unknown> {
  const chunk: Record<string, unknown> = {
    id: state.responseId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "clova",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
  if (state.usage) chunk.usage = state.usage;
  return chunk;
}

function recordUsage(state, usage): void {
  if (!usage || typeof usage !== "object") return;
  const prompt = Number(usage.promptTokens) || 0;
  const completion = Number(usage.completionTokens) || 0;
  const total = Number(usage.totalTokens) || prompt + completion;
  state.usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function recordUpstreamError(state, code: unknown, message: unknown): void {
  const status = httpStatusFromClovaCode(code);
  state.upstreamError = {
    status,
    type: status === 429 ? "rate_limit_error" : "server_error",
    code: String(code || "clova_error"),
    message: typeof message === "string" && message ? message : "CLOVA Studio upstream failure",
  };
}

/**
 * Convert a CLOVA v3 stream frame (or a non-stream JSON envelope) into OpenAI
 * chunk(s). Returns `null` when the frame contributes nothing to the client.
 */
export function convertClovaToOpenAI(
  chunk: unknown,
  state: Record<string, unknown>
): Record<string, unknown> | Array<Record<string, unknown>> | null {
  if (chunk == null) return null; // flush signal

  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.chunkIndex = 0;
  }

  let event = "";
  let data = chunk;

  if (typeof chunk === "string") {
    const frame = parseClovaSseFrame(chunk);
    if (!frame) return null;
    event = frame.event;
    data = frame.data;
  }

  if (!event && data && typeof data === "object") {
    event = String(data.event || data._eventType || "");
  }
  if (!data || typeof data !== "object") return null;

  // --- Failure envelope -----------------------------------------------------
  // Both `event: error` frames and a non-20000 `status` inside any frame mean
  // the request failed. Surface it so the stream errors out instead of ending
  // with a silent `stop`.
  const statusCode = data.status?.code ?? data.statusCode;
  if (statusCode != null && String(statusCode) !== CLOVA_STATUS_OK) {
    recordUpstreamError(state, statusCode, data.status?.message ?? data.message);
    return null;
  }
  if (event === "error" || data.error) {
    const err = data.error && typeof data.error === "object" ? data.error : data;
    recordUpstreamError(state, err.status?.code ?? err.code, err.status?.message ?? err.message);
    return null;
  }

  // --- Incremental token ---------------------------------------------------
  // Reasoning models stream `message.thinkingContent` first and then
  // `message.content`; each arrives as its own token event.
  if (event === "token") {
    const thinking = data.message?.thinkingContent ?? data.thinkingContent ?? "";
    if (thinking) return deltaChunk(state, String(thinking), "reasoning_content");

    const content = data.message?.content ?? data.content ?? "";
    if (content) return deltaChunk(state, String(content), "content");

    return null;
  }

  // --- Final snapshot ------------------------------------------------------
  // `event: result` (and the non-stream `result` envelope) carries the COMPLETE
  // text. Emitting it as a delta would duplicate everything already streamed,
  // so it only contributes finish_reason + usage.
  const isResultEvent = event === "result" || event === "stop";
  const resultEnvelope = data.result && typeof data.result === "object" ? data.result : null;
  if (isResultEvent || (!event && resultEnvelope)) {
    const result = resultEnvelope || data;
    recordUsage(state, result.usage);

    const finishReason = mapFinishReason(result.finishReason);
    // stream.ts reads state.finishReason when injecting usage into the terminal chunk.
    state.finishReason = finishReason;

    // Defensive: if this is a non-stream envelope and no token was ever
    // streamed, the client would otherwise receive an empty answer. Replay the
    // snapshot text once in that case only, followed by the terminal chunk.
    const snapshot = result.message?.content ?? result.content;
    if (!isResultEvent && state.chunkIndex === 0 && typeof snapshot === "string" && snapshot) {
      return [deltaChunk(state, snapshot), terminalChunk(state, finishReason)];
    }

    return terminalChunk(state, finishReason);
  }

  return null;
}

register(FORMATS.CLOVA, FORMATS.OPENAI, null, convertClovaToOpenAI);
