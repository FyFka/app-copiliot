import { BrowserWindow, globalShortcut, ipcMain } from "electron";
import { OverlayController, OVERLAY_WINDOW_OPTS } from "./shared/lib/overlay/index.js";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import activeWin from "active-win";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OverlayWindow {
  isInteractable = false;
  window: BrowserWindow;
  lastTrackedTitle = "";

  constructor() {
    this.window = new BrowserWindow({
      ...OVERLAY_WINDOW_OPTS,
      width: 800,
      height: 600,
      webPreferences: {
        webviewTag: true,
        spellcheck: false,
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: true,
        contextIsolation: true,
      },
    });

    this.setupIpc();
    this.registerShortCuts();
  }

  startTracking() {
    setInterval(async () => {
      try {
        const win = await activeWin();
        if (win && win.title && win.owner?.name !== "Electron") {
          if (this.lastTrackedTitle !== win.title) {
            this.lastTrackedTitle = win.title;
            this.attachOnWindow(win.title);
          }
        }
      } catch (e) {
        console.error("Tracking error:", e);
      }
    }, 1000);
  }

  setupIpc() {
    ipcMain.handle("set-click-through", (e, enabled) => {
      this.window.setIgnoreMouseEvents(enabled);
    });
  }

  loadApp() {
    const url = `http://localhost:5173/index.html`;
    this.window.loadURL(url);
  }

  registerShortCuts() {
    globalShortcut.unregisterAll();

    globalShortcut.register("CmdOrCtrl + 1", () => {
      this.window.webContents.send("visibility-change");
    });

    globalShortcut.register("CmdOrCtrl + 2", () => {
      this.isInteractable = !this.isInteractable;

      if (this.isInteractable) {
        OverlayController.activateOverlay();
      } else {
        OverlayController.focusTarget();
      }
    });
  }

  attachOnWindow(windowTitle: string) {
    console.log(windowTitle);
    OverlayController.attachByTitle(this.window, windowTitle, { hasTitleBarOnMac: true });
  }
}
