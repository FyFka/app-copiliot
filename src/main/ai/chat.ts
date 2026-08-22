import type { Message, ProviderId } from "../types.js";
import { resolveBaseUrl } from "./providers.js";

export interface ChatOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  customBaseUrl: string;
  systemPrompt: string;
  messages: Message[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

/** Reads an SSE body and yields the payload of each `data:` line. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    // An aborted request leaves the reader mid-stream; cancelling it here keeps
    // the socket from being held open until GC.
    reader.cancel().catch(() => {});
  }
}

/** Pulls the most human-readable message out of an error body. */
async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const fromError = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
      const message = fromError ?? parsed.message;
      if (message) return message;
    } catch {
      return `${response.status} ${response.statusText}: ${text.slice(0, 300)}`;
    }
  }
  return `${response.status} ${response.statusText}`;
}

async function streamOpenAiCompatible(options: ChatOptions): Promise<string> {
  const { provider, model, apiKey, customBaseUrl, systemPrompt, messages, signal, onDelta } = options;
  const baseUrl = resolveBaseUrl(provider, customBaseUrl);

  const payload = {
    model,
    stream: true,
    messages: systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages,
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }

  let content = "";
  for await (const data of readSse(response.body)) {
    if (data === "[DONE]") break;

    let parsed: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (parsed.error) throw new Error(parsed.error.message ?? "Stream error");

    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      onDelta(delta);
    }
  }

  return content;
}

async function streamGemini(options: ChatOptions): Promise<string> {
  const { provider, model, apiKey, customBaseUrl, systemPrompt, messages, signal, onDelta } = options;
  const baseUrl = resolveBaseUrl(provider, customBaseUrl);
  // Accepts both "gemini-1.5-pro" and a fully qualified "models/gemini-1.5-pro".
  const modelId = model.includes("/") ? model.split("/").pop() : model;

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const response = await fetch(`${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Passing the key as a header keeps it out of URLs and proxy logs.
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents,
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }

  let content = "";
  for await (const data of readSse(response.body)) {
    let parsed: {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (parsed.error) throw new Error(parsed.error.message ?? "Stream error");

    for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) {
        content += part.text;
        onDelta(part.text);
      }
    }
  }

  return content;
}

export function streamChat(options: ChatOptions): Promise<string> {
  return options.provider === "gemini" ? streamGemini(options) : streamOpenAiCompatible(options);
}
