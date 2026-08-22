import type {
  ActiveWindowContext,
  ChatDelta,
  ChatRequest,
  ChatResult,
  CopilotApi,
  ProviderId,
  ProviderInfo,
  PublicSettings,
  Settings,
} from "../model/types";

/**
 * The bridge only exists when the renderer runs inside Electron. Opening the
 * Vite dev server in a plain browser is useful for styling work, so every call
 * degrades to a no-op instead of throwing.
 */
const getApi = (): CopilotApi | undefined => window.copilot;

export const isCopilotAvailable = (): boolean => Boolean(getApi());

const noop = () => {};

const DEFAULT_SETTINGS: PublicSettings = {
  provider: "openai",
  model: "gpt-4o",
  customBaseUrl: "",
  systemPrompt: "",
  shareContext: true,
  savedKeys: { openai: false, gemini: false, deepseek: false, custom: false },
  secureStorage: false,
};

export const copilotApi = {
  setClickThrough(enabled: boolean): Promise<void> {
    return getApi()?.setClickThrough(enabled) ?? Promise.resolve();
  },

  hide(): Promise<void> {
    return getApi()?.hide() ?? Promise.resolve();
  },

  onVisibilityChange(callback: (visible: boolean) => void): () => void {
    return getApi()?.onVisibilityChange(callback) ?? noop;
  },

  onContextChange(callback: (context: ActiveWindowContext) => void): () => void {
    return getApi()?.onContextChange(callback) ?? noop;
  },

  onChatDelta(callback: (delta: ChatDelta) => void): () => void {
    return getApi()?.onChatDelta(callback) ?? noop;
  },

  getProviders(): Promise<ProviderInfo[]> {
    return getApi()?.getProviders() ?? Promise.resolve([]);
  },

  getSettings(): Promise<PublicSettings> {
    return getApi()?.getSettings() ?? Promise.resolve(DEFAULT_SETTINGS);
  },

  setSettings(patch: Partial<Settings>): Promise<PublicSettings> {
    return getApi()?.setSettings(patch) ?? Promise.resolve({ ...DEFAULT_SETTINGS, ...patch });
  },

  setApiKey(provider: ProviderId, key: string): Promise<PublicSettings> {
    return getApi()?.setApiKey(provider, key) ?? Promise.resolve(DEFAULT_SETTINGS);
  },

  getContext(): Promise<ActiveWindowContext> {
    return getApi()?.getContext() ?? Promise.resolve({ title: "", app: "" });
  },

  ask(request: ChatRequest): Promise<ChatResult> {
    return (
      getApi()?.ask(request) ?? Promise.resolve({ content: "", error: "The copilot bridge is unavailable" })
    );
  },

  abort(requestId: string): Promise<void> {
    return getApi()?.abort(requestId) ?? Promise.resolve();
  },
};
