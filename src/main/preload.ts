import { contextBridge, ipcRenderer } from "electron";
import type { ChatPayload, CopilotApi } from "./types";

const api: CopilotApi = {
  onVisibilityChange: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("visibility-change", handler);
    return () => {
      ipcRenderer.removeListener("visibility-change", handler);
    };
  },
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("set-click-through", enabled),
  ask: (payload: ChatPayload) => ipcRenderer.invoke("ask-ai", payload),
};

contextBridge.exposeInMainWorld("copilot", api);
