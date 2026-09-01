/**
 * OpenAI → Naver CLOVA Studio "Chat Completions v3" request translator.
 *
 * Wire format: `POST https://clovastudio.stream.ntruss.com/v3/chat-completions/{modelName}`
 *
 * What makes this a real translation rather than a field rename:
 *
 * 1. **The model travels in the URL path, not the body.** CLOVA v3 takes
 *    `/v3/chat-completions/HCX-005`, so `model` is stripped from the payload.
 * 2. **Sampling params are camelCase** (`maxTokens`, `topP`, `topK`,
 *    `repetitionPenalty`) where OpenAI uses snake_case.
 * 3. **`content` is always an array of typed parts** (`{type:"text"}` /
 *    `{type:"image_url"}`), and images use Naver's container names
 *    (`imageUrl.url` for a public URL, `dataUri.data` for a base64 payload —
 *    which must keep its full `data:...;base64,` prefix).
 * 4. **Reasoning models (HCX-007) use a different parameter contract**: only
 *    `maxCompletionTokens` is accepted (`maxTokens` is rejected with status
 *    40001), `stop` is rejected outright, and images are unsupported.
 *
 * Every rule below marked "live-verified" was confirmed against the real API on
 * 2026-09-01; the rest come from the vendor docs:
 *   - text/image: https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3
 *   - thinking:   https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking
 */
import { register } from "../registry.ts";
import { FORMATS } from "../formats.ts";

/** Output cap for the documented non-reasoning v3 models (HCX-005, HCX-DASH-002). */
export const CLOVA_V3_MAX_OUTPUT_TOKENS = 4096;

/** Output cap for the v3 reasoning model (HCX-007) — includes thinking tokens. */
export const CLOVA_V3_REASONING_MAX_OUTPUT_TOKENS = 32768;

/** v3 models that think before answering and therefore use the reasoning contract. */
export const CLOVA_V3_REASONING_MODELS: ReadonlySet<string> = new Set(["HCX-007"]);

/** v3 models that accept image input. HCX-007 explicitly does not. */
export const CLOVA_V3_VISION_MODELS: ReadonlySet<string> = new Set(["HCX-005"]);

/** Accepted `thinking.effort` values (vendor enum). */
const CLOVA_THINKING_EFFORTS: ReadonlySet<string> = new Set(["none", "low", "medium", "high"]);

export function isClovaReasoningModel(model: string): boolean {
  return typeof model === "string" && CLOVA_V3_REASONING_MODELS.has(model.toUpperCase());
}

export function isClovaVisionModel(model: string): boolean {
  return typeof model === "string" && CLOVA_V3_VISION_MODELS.has(model.toUpperCase());
}

/** Clamp a numeric sampling param into CLOVA's documented accepted range. */
function clampNumeric(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

/**
 * Map OpenAI `reasoning_effort` onto CLOVA's `thinking.effort`.
 * OpenAI's `minimal` collapses to `low`; anything unrecognised returns "" so the
 * field is omitted and CLOVA applies its own default (`low`).
 */
export function toClovaThinkingEffort(reasoningEffort: unknown): string {
  if (typeof reasoningEffort !== "string") return "";
  const effort = reasoningEffort.toLowerCase();
  if (effort === "minimal") return "low";
  return CLOVA_THINKING_EFFORTS.has(effort) ? effort : "";
}

/**
 * Convert one OpenAI `content` value into CLOVA v3 typed content parts.
 *
 * Both image transports are supported and live-verified (2026-09-01):
 *   - a public URL becomes `{type:"image_url", imageUrl:{url}}`
 *   - a `data:` URL becomes `{type:"image_url", dataUri:{data}}` where `data`
 *     holds the ENTIRE data-URI string. Stripping the `data:...;base64,` prefix
 *     makes CLOVA reject the request with `40001 Invalid parameter`; keeping it
 *     works for PNG and JPEG at every size tried (16x16 → full size).
 */
export function toClovaContent(
  content: unknown,
  supportsImages: boolean
): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ type: "text", text: content == null ? "" : String(content) }];
  }

  const parts: Array<Record<string, unknown>> = [];

  for (const part of content) {
    if (!part || typeof part !== "object") continue;

    if (part.type === "text" || typeof part.text === "string") {
      const text = typeof part.text === "string" ? part.text : "";
      if (text) parts.push({ type: "text", text });
      continue;
    }

    if (part.type === "image_url" && supportsImages) {
      const url: string = part.image_url?.url || part.url || "";
      if (!url) continue;
      if (url.startsWith("data:")) {
        // CLOVA wants the COMPLETE data-URI string — including the
        // `data:image/png;base64,` prefix — inside `dataUri.data`. A bare
        // base64 payload is rejected with `40001 Invalid parameter`, so the
        // client's `data:` URL is forwarded verbatim. Live-verified with PNG
        // and JPEG at 16x16, 64x64 and full size (2026-09-01).
        parts.push({ type: "image_url", dataUri: { data: url } });
      } else {
        parts.push({ type: "image_url", imageUrl: { url } });
      }
    }
  }

  // CLOVA rejects a message with an empty content array, so always emit a part.
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

/**
 * Build the CLOVA Studio v3 request body from an OpenAI Chat Completions body.
 */
export function buildClovaPayload(
  model: string,
  body: Record<string, unknown>,
  stream: boolean,
  credentials?: Record<string, unknown> | null
): Record<string, unknown> {
  void stream;
  void credentials;

  const reasoning = isClovaReasoningModel(model);
  const supportsImages = !reasoning && isClovaVisionModel(model);

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const payload: Record<string, unknown> = {
    messages: messages.map((msg) => ({
      role: msg?.role === "assistant" || msg?.role === "system" ? msg.role : "user",
      content: toClovaContent(msg?.content, supportsImages),
    })),
  };

  // Reasoning (HCX-007 only). CLOVA defaults to `low` when omitted.
  if (reasoning) {
    const effort = toClovaThinkingEffort(body?.reasoning_effort);
    if (effort) payload.thinking = { effort };
  }

  const temperature = clampNumeric(body?.temperature, 0, 1);
  if (temperature !== null) payload.temperature = temperature;

  const topP = clampNumeric(body?.top_p, 0, 1);
  if (topP !== null && topP > 0) payload.topP = topP;

  // OpenAI has no `top_k`; agent clients (and OmniRoute passthrough) still send
  // it, and CLOVA accepts 0–128.
  const topK = clampNumeric(body?.top_k, 0, 128);
  if (topK !== null && topK > 0) payload.topK = topK;

  // Reasoning models reject `maxTokens` outright (live-verified: status 40001
  // "Invalid parameter: maxTokens") and cap at 32768 including thinking tokens.
  // Non-reasoning models cap at 4096.
  const cap = reasoning ? CLOVA_V3_REASONING_MAX_OUTPUT_TOKENS : CLOVA_V3_MAX_OUTPUT_TOKENS;
  const requestedTokens = body?.max_completion_tokens ?? body?.max_tokens;
  const tokens = clampNumeric(requestedTokens, 1, cap);
  if (tokens !== null) {
    payload[reasoning ? "maxCompletionTokens" : "maxTokens"] = tokens;
  }

  const repetitionPenalty = clampNumeric(body?.repetition_penalty, 0, 2);
  if (repetitionPenalty !== null && repetitionPenalty > 0) {
    payload.repetitionPenalty = repetitionPenalty;
  }

  // `stop` is rejected while thinking ("추론 사용 시 Chat Completions V3의 stop은
  // 사용할 수 없습니다"), so it is only forwarded for non-reasoning models.
  if (!reasoning) {
    if (Array.isArray(body?.stop) && body.stop.length > 0) {
      payload.stop = body.stop.filter((s) => typeof s === "string");
    } else if (typeof body?.stop === "string" && body.stop) {
      payload.stop = [body.stop];
    }
  }

  const seed = clampNumeric(body?.seed, 0, 4294967295);
  if (seed !== null && seed > 0) payload.seed = Math.floor(seed);

  if (body?.include_ai_filters === true) payload.includeAiFilters = true;

  // `model` lives in the URL path and `stream` is driven by the Accept header
  // (BaseExecutor sets `text/event-stream` when streaming), so neither is sent.
  // `tools` / `tool_choice` / `response_format` belong to the separate v3
  // function-calling and structured-output endpoints and are dropped rather than
  // forwarded into a request this endpoint would reject.
  return payload;
}

register(FORMATS.OPENAI, FORMATS.CLOVA, buildClovaPayload, null);
