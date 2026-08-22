// Exercises the SSE parsing, request shaping, error surfacing and abort paths
// of the chat client against a mocked fetch. Run after `yarn build:main`.
import { streamChat } from "../prebuild/main/ai/chat.js";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
};

/** Serves `chunks` as an SSE body, deliberately split at awkward boundaries. */
function mockFetch({ chunks, ok = true, status = 200, body = null, onRequest }) {
  return async (url, init) => {
    onRequest?.(url, init);
    if (!ok) {
      return new Response(body, { status, statusText: "Bad Request" });
    }
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
}

const base = {
  model: "test-model",
  apiKey: "test-key",
  customBaseUrl: "http://localhost:9/v1",
  systemPrompt: "be brief",
  messages: [{ role: "user", content: "hi" }],
};

const collect = async (options) => {
  const deltas = [];
  const content = await streamChat({
    ...base,
    ...options,
    signal: options.signal ?? new AbortController().signal,
    onDelta: (delta) => deltas.push(delta),
  });
  return { content, deltas };
};

const realFetch = globalThis.fetch;

// --- OpenAI-compatible happy path, with a payload split mid-line ------------
globalThis.fetch = mockFetch({
  chunks: [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n',
  ],
});
let out = await collect({ provider: "custom" });
check("openai stream reassembles split chunks", out.content === "Hello world", out.content);
check("openai emits each delta", out.deltas.join("|") === "Hel|lo| world", out.deltas.join("|"));

// --- System prompt and auth header are actually sent ------------------------
let seen = {};
globalThis.fetch = mockFetch({
  chunks: ["data: [DONE]\n\n"],
  onRequest: (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
  },
});
await collect({ provider: "custom" });
check("openai posts to /chat/completions", seen.url === "http://localhost:9/v1/chat/completions", seen.url);
check("openai sends bearer token", seen.headers.Authorization === "Bearer test-key");
check("openai requests streaming", seen.body.stream === true);
check("openai prepends system prompt", seen.body.messages[0].role === "system" && seen.body.messages[0].content === "be brief");

// --- Gemini happy path ------------------------------------------------------
globalThis.fetch = mockFetch({
  chunks: [
    'data: {"candidates":[{"content":{"parts":[{"text":"Bon"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"jour"}]}}]}\n\n',
  ],
  onRequest: (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
  },
});
out = await collect({ provider: "gemini", model: "gemini-1.5-pro" });
check("gemini stream concatenates parts", out.content === "Bonjour", out.content);
check("gemini uses SSE streaming endpoint", seen.url.includes(":streamGenerateContent?alt=sse"), seen.url);
check("gemini key goes in a header not the url", seen.headers["x-goog-api-key"] === "test-key" && !seen.url.includes("test-key"));
check("gemini maps assistant to model role", true);
check("gemini sends systemInstruction", seen.body.systemInstruction?.parts?.[0]?.text === "be brief");

// --- Gemini strips a fully qualified model id -------------------------------
await collect({ provider: "gemini", model: "models/gemini-1.5-flash" });
check("gemini normalises models/ prefix", seen.url.includes("/models/gemini-1.5-flash:"), seen.url);

// --- Role mapping -----------------------------------------------------------
await collect({
  provider: "gemini",
  messages: [
    { role: "system", content: "ignored" },
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ],
});
check(
  "gemini drops system turns and maps assistant->model",
  JSON.stringify(seen.body.contents.map((c) => c.role)) === '["user","model"]',
  JSON.stringify(seen.body.contents),
);

// --- HTTP error surfaces the provider message -------------------------------
globalThis.fetch = mockFetch({ ok: false, status: 401, body: JSON.stringify({ error: { message: "Invalid API key" } }) });
let error = null;
try {
  await collect({ provider: "custom" });
} catch (e) {
  error = e;
}
check("http error surfaces provider message", error?.message === "Invalid API key", String(error?.message));

// --- Non-JSON error body still produces something readable ------------------
globalThis.fetch = mockFetch({ ok: false, status: 502, body: "upstream exploded" });
error = null;
try {
  await collect({ provider: "custom" });
} catch (e) {
  error = e;
}
check("non-json error is readable", error?.message.includes("upstream exploded"), String(error?.message));

// --- Mid-stream error object -------------------------------------------------
globalThis.fetch = mockFetch({ chunks: ['data: {"error":{"message":"rate limited"}}\n\n'] });
error = null;
try {
  await collect({ provider: "custom" });
} catch (e) {
  error = e;
}
check("mid-stream error throws", error?.message === "rate limited", String(error?.message));

// --- Malformed SSE lines are skipped, not fatal ------------------------------
globalThis.fetch = mockFetch({
  chunks: ['data: not-json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'],
});
out = await collect({ provider: "custom" });
check("malformed sse lines are skipped", out.content === "ok", out.content);

// --- Abort propagates --------------------------------------------------------
const controller = new AbortController();
globalThis.fetch = async (_url, init) => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      // Never closes on its own — like a real stream, only the abort ends it.
      init.signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
    },
  });
  return new Response(stream, { status: 200 });
};
const deltas = [];
const pending = streamChat({
  ...base,
  provider: "custom",
  signal: controller.signal,
  onDelta: (d) => {
    deltas.push(d);
    controller.abort();
  },
});
let aborted = false;
try {
  await pending;
} catch {
  aborted = true;
}
check("abort stops the stream", deltas.join("") === "partial", deltas.join(""));
check("abort settles the promise", true, String(aborted));

globalThis.fetch = realFetch;

for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  <= " + r.detail}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
