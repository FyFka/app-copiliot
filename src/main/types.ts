export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatPayload {
  messages: Message[];
  model: string;
  apiKey: string;
}

export interface ChatResponse {
  content: string;
  error?: string;
}

export interface CopilotApi {
  setClickThrough: (enabled: boolean) => Promise<void>;
  onVisibilityChange: (callback: () => void) => () => void;
  ask: (payload: ChatPayload) => Promise<ChatResponse>;
}

declare global {
  interface Window {
    copilot: CopilotApi;
  }
}
