import test from "node:test";
import assert from "node:assert/strict";

// Naver CLOVA Studio "Chat Completions v3" translator pair.
//
// The guard that matters most here is the stream-duplication case: `event: token`
// carries an INCREMENTAL delta while the terminal `event: result` repeats the
// COMPLETE text. Concatenating both doubles the whole answer at the end of the
// stream, so the result event must contribute finish_reason + usage only.
//
// Wire docs: https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3

const request = await import("../../open-sse/translator/request/openai-to-clova.ts");
const response = await import("../../open-sse/translator/response/clova-to-openai.ts");
const registry = await import("../../open-sse/translator/registry.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");

// ---------------------------------------------------------------------------
// Request: OpenAI → CLOVA v3
// ---------------------------------------------------------------------------

test("clova v3: registers the request and response translator pair", () => {
  assert.ok(registry.getRequestTranslator(FORMATS.OPENAI, FORMATS.CLOVA));
  assert.ok(registry.getResponseTranslator(FORMATS.CLOVA, FORMATS.OPENAI));
});

test("clova v3: string content becomes a typed text part", () => {
  const body = { messages: [{ role: "user", content: "hello" }] };
  const payload = request.buildClovaPayload("HCX-005", body, true, null);
  assert.deepEqual(payload.messages[0], {
    role: "user",
    content: [{ type: "text", text: "hello" }],
  });
});

test("clova v3: sampling params are camelCased", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 512,
      top_p: 0.8,
      top_k: 4,
      temperature: 0.5,
      repetition_penalty: 1.15,
      seed: 42,
      stop: ["END"],
    },
    true,
    null
  );
  assert.equal(payload.maxTokens, 512);
  assert.equal(payload.topP, 0.8);
  assert.equal(payload.topK, 4);
  assert.equal(payload.temperature, 0.5);
  assert.equal(payload.repetitionPenalty, 1.15);
  assert.equal(payload.seed, 42);
  assert.deepEqual(payload.stop, ["END"]);
  // snake_case must not leak upstream.
  assert.equal(payload.max_tokens, undefined);
  assert.equal(payload.top_p, undefined);
});

test("clova v3: output tokens are clamped to the documented 4096 cap", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    { messages: [{ role: "user", content: "hi" }], max_tokens: 100000 },
    true,
    null
  );
  assert.equal(payload.maxTokens, request.CLOVA_V3_MAX_OUTPUT_TOKENS);
});

test("clova v3: max_completion_tokens on a text model still maps to maxTokens", () => {
  // Only reasoning models speak `maxCompletionTokens`; for text models the cap is
  // `maxTokens` regardless of which OpenAI alias the client used.
  const payload = request.buildClovaPayload(
    "HCX-005",
    { messages: [{ role: "user", content: "hi" }], max_completion_tokens: 1024 },
    true,
    null
  );
  assert.equal(payload.maxTokens, 1024);
  assert.equal(payload.maxCompletionTokens, undefined);
});

test("clova v3: model and stream are not sent in the body", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    { model: "HCX-005", stream: true, messages: [{ role: "user", content: "hi" }] },
    true,
    null
  );
  // The model travels in the URL path and streaming is driven by Accept.
  assert.equal(payload.model, undefined);
  assert.equal(payload.stream, undefined);
});

test("clova v3: tools are dropped (the v3 text/image endpoint has no function calling)", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "get_weather" } }],
      tool_choice: "auto",
      response_format: { type: "json_object" },
    },
    true,
    null
  );
  assert.equal(payload.tools, undefined);
  assert.equal(payload.tool_choice, undefined);
  assert.equal(payload.response_format, undefined);
});

test("clova v3: a public image URL maps to imageUrl.url", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    },
    true,
    null
  );
  const parts = payload.messages[0].content;
  assert.deepEqual(parts[1], {
    type: "image_url",
    imageUrl: { url: "https://example.com/a.png" },
  });
});

test("clova v3: base64 images keep their full data-URI prefix in dataUri.data", () => {
  // Regression guard: the prefix MUST survive. Sending only the base64 payload
  // (prefix stripped) makes CLOVA reject the whole request with
  // `40001 Invalid parameter`, while the complete data-URI string is accepted.
  // Live-verified 2026-09-01 with PNG and JPEG at 16x16, 64x64 and full size.
  const payload = request.buildClovaPayload(
    "HCX-005",
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAABBBB" } },
            { type: "text", text: "what is this" },
          ],
        },
      ],
    },
    true,
    null
  );
  assert.deepEqual(payload.messages[0].content[0], {
    type: "image_url",
    dataUri: { data: "data:image/png;base64,AAAABBBB" },
  });
  assert.deepEqual(payload.messages[0].content[1], { type: "text", text: "what is this" });
});

test("clova v3: a data: image never leaks into imageUrl.url", () => {
  const payload = request.buildClovaPayload(
    "HCX-005",
    {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,ZZZZ" } }],
        },
      ],
    },
    true,
    null
  );
  const part = payload.messages[0].content[0];
  assert.equal(part.imageUrl, undefined);
  assert.deepEqual(part.dataUri, { data: "data:image/jpeg;base64,ZZZZ" });
});

test("clova v3: images are stripped for a text-only model", () => {
  const payload = request.buildClovaPayload(
    "HCX-DASH-002",
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
            { type: "text", text: "describe" },
          ],
        },
      ],
    },
    true,
    null
  );
  assert.deepEqual(payload.messages[0].content, [{ type: "text", text: "describe" }]);
});

// ---------------------------------------------------------------------------
// Reasoning model (HCX-007) contract
// ---------------------------------------------------------------------------

test("clova v3: reasoning models use maxCompletionTokens, never maxTokens", () => {
  // Live-verified: HCX-007 answers 40001 "Invalid parameter: maxTokens" when the
  // cap is sent as `maxTokens`, and succeeds with `maxCompletionTokens`.
  const withMaxTokens = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }], max_tokens: 1024 },
    true,
    null
  );
  assert.equal(withMaxTokens.maxCompletionTokens, 1024);
  assert.equal(withMaxTokens.maxTokens, undefined);

  const withMaxCompletion = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }], max_completion_tokens: 2048 },
    true,
    null
  );
  assert.equal(withMaxCompletion.maxCompletionTokens, 2048);
});

test("clova v3: reasoning output cap is 32768, not the 4096 text-model cap", () => {
  const payload = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }], max_tokens: 999999 },
    true,
    null
  );
  assert.equal(payload.maxCompletionTokens, request.CLOVA_V3_REASONING_MAX_OUTPUT_TOKENS);

  const textModel = request.buildClovaPayload(
    "HCX-005",
    { messages: [{ role: "user", content: "hi" }], max_tokens: 999999 },
    true,
    null
  );
  assert.equal(textModel.maxTokens, request.CLOVA_V3_MAX_OUTPUT_TOKENS);
});

test("clova v3: stop is dropped for reasoning models", () => {
  // The vendor docs state `stop` cannot be used while thinking.
  const reasoning = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }], stop: ["END"] },
    true,
    null
  );
  assert.equal(reasoning.stop, undefined);

  const text = request.buildClovaPayload(
    "HCX-005",
    { messages: [{ role: "user", content: "hi" }], stop: ["END"] },
    true,
    null
  );
  assert.deepEqual(text.stop, ["END"]);
});

test("clova v3: images are stripped for the reasoning model (HCX-007 has no vision)", () => {
  const payload = request.buildClovaPayload(
    "HCX-007",
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
            { type: "text", text: "describe" },
          ],
        },
      ],
    },
    true,
    null
  );
  assert.deepEqual(payload.messages[0].content, [{ type: "text", text: "describe" }]);
});

test("clova v3: reasoning_effort maps onto thinking.effort", () => {
  assert.equal(request.toClovaThinkingEffort("low"), "low");
  assert.equal(request.toClovaThinkingEffort("high"), "high");
  // OpenAI's `minimal` has no CLOVA equivalent; `low` is the closest.
  assert.equal(request.toClovaThinkingEffort("minimal"), "low");
  // Unknown values are omitted so CLOVA applies its own default.
  assert.equal(request.toClovaThinkingEffort("bogus"), "");

  const payload = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
    true,
    null
  );
  assert.deepEqual(payload.thinking, { effort: "high" });

  const noEffort = request.buildClovaPayload(
    "HCX-007",
    { messages: [{ role: "user", content: "hi" }] },
    true,
    null
  );
  assert.equal(noEffort.thinking, undefined);

  // Non-reasoning models must never receive the thinking envelope.
  const textModel = request.buildClovaPayload(
    "HCX-005",
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
    true,
    null
  );
  assert.equal(textModel.thinking, undefined);
});

// ---------------------------------------------------------------------------
// Response: CLOVA v3 → OpenAI
// ---------------------------------------------------------------------------

function tokenFrame(text: string): string {
  return (
    `id: aabb\n` +
    `event: token\n` +
    `data: ${JSON.stringify({ message: { role: "assistant", content: text }, finishReason: null, created: 1 })}\n\n`
  );
}

function resultFrame(fullText: string): string {
  return (
    `id: aabb\n` +
    `event: result\n` +
    `data: ${JSON.stringify({
      message: { role: "assistant", content: fullText },
      finishReason: "stop",
      created: 1,
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    })}\n\n`
  );
}

test("clova v3: a token frame emits an incremental delta", () => {
  const state = {};
  const chunk = response.convertClovaToOpenAI(tokenFrame("안"), state);
  assert.equal(chunk.choices[0].delta.content, "안");
  // First chunk carries the assistant role, per OpenAI semantics.
  assert.equal(chunk.choices[0].delta.role, "assistant");
  assert.equal(chunk.choices[0].finish_reason, null);
});

test("clova v3: the result frame does NOT repeat the already-streamed text", () => {
  const state = {};
  response.convertClovaToOpenAI(tokenFrame("안"), state);
  response.convertClovaToOpenAI(tokenFrame("녕"), state);
  const terminal = response.convertClovaToOpenAI(resultFrame("안녕"), state);

  // The snapshot text must not be re-emitted — this is the duplication guard.
  assert.equal(terminal.choices[0].delta.content, undefined);
  assert.deepEqual(terminal.choices[0].delta, {});
  assert.equal(terminal.choices[0].finish_reason, "stop");
});

test("clova v3: a full token→result stream yields the answer exactly once", () => {
  const state = {};
  const frames = [tokenFrame("안"), tokenFrame("녕"), resultFrame("안녕")];
  const text = frames
    .map((frame) => response.convertClovaToOpenAI(frame, state))
    .filter(Boolean)
    .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
    .join("");

  assert.equal(text, "안녕");
  assert.notEqual(text, "안녕안녕");
  assert.deepEqual(state.usage, {
    prompt_tokens: 20,
    completion_tokens: 5,
    total_tokens: 25,
  });
});

test("clova v3: an upstream status failure surfaces as state.upstreamError", () => {
  const state = {};
  const frame =
    `id: aabb\n` +
    `event: error\n` +
    `data: ${JSON.stringify({ status: { code: "40100", message: "Invalid API key" } })}\n\n`;

  assert.equal(response.convertClovaToOpenAI(frame, state), null);
  assert.equal(state.upstreamError.status, 400);
  assert.match(state.upstreamError.message, /Invalid API key/);
});

test("clova v3: a 5xxxx status maps to a 502 upstream error", () => {
  const state = {};
  const payload = {
    status: { code: "50000", message: "Internal Server Error" },
    result: null,
  };
  assert.equal(response.convertClovaToOpenAI(payload, state), null);
  assert.equal(state.upstreamError.status, 502);
});

test("clova v3: a non-stream envelope replays its text once, then terminates", () => {
  const state = {};
  const out = response.convertClovaToOpenAI(
    {
      status: { code: "20000", message: "OK" },
      result: {
        message: { role: "assistant", content: "hello" },
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: "stop",
      },
    },
    state
  );

  assert.ok(Array.isArray(out));
  assert.equal(out[0].choices[0].delta.content, "hello");
  assert.equal(out[1].choices[0].finish_reason, "stop");
  assert.equal(state.usage.total_tokens, 3);
});

test("clova v3: thinkingContent is emitted as reasoning_content", () => {
  const state = {};
  const frame =
    `id: aabb\n` +
    `event: token\n` +
    `data: ${JSON.stringify({ message: { role: "assistant", thinkingContent: "생각" }, finishReason: null })}\n\n`;

  const chunk = response.convertClovaToOpenAI(frame, state);
  assert.equal(chunk.choices[0].delta.reasoning_content, "생각");
  assert.equal(chunk.choices[0].delta.content, undefined);
});

test("clova v3: reasoning and answer deltas stay on separate delta keys", () => {
  const state = {};
  const thinking = response.convertClovaToOpenAI(
    `event: token\ndata: ${JSON.stringify({ message: { thinkingContent: "because" } })}\n\n`,
    state
  );
  const answer = response.convertClovaToOpenAI(
    `event: token\ndata: ${JSON.stringify({ message: { content: "391" } })}\n\n`,
    state
  );

  assert.equal(thinking.choices[0].delta.reasoning_content, "because");
  assert.equal(answer.choices[0].delta.content, "391");
  assert.equal(answer.choices[0].delta.reasoning_content, undefined);
});

test("clova v3: the flush signal and unparseable frames return null", () => {
  const state = {};
  assert.equal(response.convertClovaToOpenAI(null, state), null);
  assert.equal(response.convertClovaToOpenAI("id: aabb\nevent: ping\ndata: \n\n", state), null);
  assert.equal(response.convertClovaToOpenAI("not json at all", state), null);
});

test("clova v3: an unknown event type is ignored", () => {
  const state = {};
  const frame = `event: signal\ndata: ${JSON.stringify({ data: "keepalive" })}\n\n`;
  assert.equal(response.convertClovaToOpenAI(frame, state), null);
});
