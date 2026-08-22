import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
} from "./types.js";

/** Subscribes to a main-process event and returns an unsubscribe function. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: CopilotApi = {
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("overlay:set-click-through", enabled),
  hide: () => ipcRenderer.invoke("overlay:hide"),

  onVisibilityChange: (callback: (visible: boolean) => void) => subscribe<boolean>("visibility:change", callback),
  onContextChange: (callback: (context: ActiveWindowContext) => void) =>
    subscribe<ActiveWindowContext>("context:change", callback),
  onChatDelta: (callback: (delta: ChatDelta) => void) => subscribe<ChatDelta>("chat:delta", callback),

  getProviders: (): Promise<ProviderInfo[]> => ipcRenderer.invoke("providers:list"),
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<Settings>): Promise<PublicSettings> => ipcRenderer.invoke("settings:set", patch),
  setApiKey: (provider: ProviderId, key: string): Promise<PublicSettings> =>
    ipcRenderer.invoke("settings:set-api-key", provider, key),
  getContext: (): Promise<ActiveWindowContext> => ipcRenderer.invoke("context:get"),

  ask: (request: ChatRequest): Promise<ChatResult> => ipcRenderer.invoke("chat:send", request),
  abort: (requestId: string): Promise<void> => ipcRenderer.invoke("chat:abort", requestId),
};

contextBridge.exposeInMainWorld("copilot", api);
