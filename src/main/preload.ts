import { contextBridge, ipcRenderer } from "electron";

export interface ChatReply {
  role: "assistant";
  content: string;
}

contextBridge.exposeInMainWorld("copilot", {
  setClickThrough(enabled: boolean) {
    return ipcRenderer.invoke("overlay:set-click-through", enabled);
  },

  focusTarget() {
    return ipcRenderer.invoke("overlay:focus-target");
  },

  hide() {
    return ipcRenderer.invoke("overlay:hide");
  },

  sendMessage(text: string): Promise<ChatReply> {
    return ipcRenderer.invoke("chat:send", text);
  },

  onPanelWidth(callback: (width: number) => void) {
    const handler = (_event: Electron.IpcRendererEvent, width: number) => {
      callback(width);
    };
    ipcRenderer.on("overlay:panel-width", handler);
    return () => {
      ipcRenderer.off("overlay:panel-width", handler);
    };
  },
});
