import { app, Tray, Menu, nativeImage } from "electron";
import { OverlayWindow } from "./overlay-window.js";

let tray: Tray | null = null;

app.on("ready", () => {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([{ label: "Quit", click: () => app.quit() }]);
  tray.setToolTip("Electron Overlay");
  tray.setContextMenu(contextMenu);

  const overlay = new OverlayWindow();
  overlay.loadApp();
  overlay.startTracking();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
