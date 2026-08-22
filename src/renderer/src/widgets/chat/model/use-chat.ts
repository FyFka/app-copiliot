import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { copilotApi, type Message } from "@/shared";

const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface ChatState {
  messages: Message[];
  /** Assistant text received so far for the in-flight reply, if any. */
  streamed: string | null;
  isLoading: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export const useChat = (): ChatState => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamed, setStreamed] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  // Mirrors `streamed` so the request can read the partial text without turning
  // a state updater into something that has side effects.
  const streamedRef = useRef("");

  useEffect(() => {
    // Deltas from an older, superseded request must not bleed into the current
    // reply, so every chunk is matched against the request that is in flight.
    return copilotApi.onChatDelta(({ requestId, delta }) => {
      if (requestId !== requestIdRef.current) return;
      streamedRef.current += delta;
      setStreamed(streamedRef.current);
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || requestIdRef.current) return;

      const history = [...messages, { role: "user", content: trimmed } as Message];
      const requestId = newRequestId();

      requestIdRef.current = requestId;
      streamedRef.current = "";
      setMessages(history);
      setStreamed("");
      setIsLoading(true);

      try {
        const result = await copilotApi.ask({ requestId, messages: history });

        // Prefer the streamed text: on abort the result carries no content, but
        // whatever already arrived is still worth keeping.
        const content = result.content || streamedRef.current;
        setStreamed(null);
        if (content) setMessages([...history, { role: "assistant", content }]);

        if (result.error) toast.error(result.error);
      } catch (error) {
        console.error("chat: request failed", error);
        setStreamed(null);
        toast.error("Could not reach the AI provider");
      } finally {
        streamedRef.current = "";
        requestIdRef.current = null;
        setIsLoading(false);
      }
    },
    [messages],
  );

  const stop = useCallback(() => {
    const requestId = requestIdRef.current;
    if (requestId) void copilotApi.abort(requestId);
  }, []);

  const reset = useCallback(() => {
    stop();
    streamedRef.current = "";
    setMessages([]);
    setStreamed(null);
  }, [stop]);

  return { messages, streamed, isLoading, send, stop, reset };
};
