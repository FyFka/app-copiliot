import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("copilot", {
  onVisibilityChange: (callback: () => void) => {
    const handler = (_event: Electron.IpcRendererEvent) => callback();
    ipcRenderer.on("visibility-change", handler);

    return () => ipcRenderer.removeListener("visibility-change", handler);
  },
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("set-click-through", enabled),
});
