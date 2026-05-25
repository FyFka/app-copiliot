declare global {
  interface Window {
    copilot: CopilotApi;
  }
}

export interface ChatReply {
  role: "assistant";
  content: string;
}

export interface CopilotApi {
  setClickThrough(enabled: boolean): Promise<void>;
  onVisibilityChange(callback: () => void): void;
}
