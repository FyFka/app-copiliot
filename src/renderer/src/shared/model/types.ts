export type ProviderId = "openai" | "gemini" | "deepseek" | "custom";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  requestId: string;
  messages: Message[];
}

export interface ChatResult {
  content: string;
  error?: string;
  aborted?: boolean;
}

export interface ChatDelta {
  requestId: string;
  delta: string;
}

export interface Settings {
  provider: ProviderId;
  model: string;
  customBaseUrl: string;
  systemPrompt: string;
  shareContext: boolean;
}

export interface PublicSettings extends Settings {
  savedKeys: Record<ProviderId, boolean>;
  secureStorage: boolean;
}

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: ProviderModel[];
  apiKeyUrl?: string;
  needsBaseUrl: boolean;
}

export interface ActiveWindowContext {
  title: string;
  app: string;
}

export interface CopilotApi {
  setClickThrough(enabled: boolean): Promise<void>;
  hide(): Promise<void>;

  onVisibilityChange(callback: (visible: boolean) => void): () => void;
  onContextChange(callback: (context: ActiveWindowContext) => void): () => void;
  onChatDelta(callback: (delta: ChatDelta) => void): () => void;

  getProviders(): Promise<ProviderInfo[]>;
  getSettings(): Promise<PublicSettings>;
  setSettings(patch: Partial<Settings>): Promise<PublicSettings>;
  setApiKey(provider: ProviderId, key: string): Promise<PublicSettings>;
  getContext(): Promise<ActiveWindowContext>;

  ask(request: ChatRequest): Promise<ChatResult>;
  abort(requestId: string): Promise<void>;
}

declare global {
  interface Window {
    copilot?: CopilotApi;
  }
}
