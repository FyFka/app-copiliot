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

/** Settings as they live in the main process. The API keys never leave it. */
export interface Settings {
  provider: ProviderId;
  model: string;
  /** Base URL for the `custom` provider (any OpenAI-compatible endpoint). */
  customBaseUrl: string;
  systemPrompt: string;
  /** Send the focused window's title along with the prompt. */
  shareContext: boolean;
}

/** What the renderer is allowed to see: same as Settings, minus the secrets. */
export interface PublicSettings extends Settings {
  /** Which providers currently have a stored key. */
  savedKeys: Record<ProviderId, boolean>;
  /** False when the OS offers no encrypted store, so keys live in memory only. */
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
  /** The `custom` provider needs a user-supplied base URL and model name. */
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
