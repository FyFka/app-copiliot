import { app, globalShortcut, Tray } from "electron";
import { OverlayWindow } from "./overlay-window.js";
import { SettingsStore } from "./settings.js";
import { createTray } from "./tray.js";

// A second instance would fight the first one over the global shortcuts and the
// settings file, so hand focus back to the original and exit.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let tray: Tray | null = null;
  let overlay: OverlayWindow | null = null;

  app.on("second-instance", () => overlay?.setVisible(true));

  app.on("ready", () => {
    app.setAppUserModelId("com.app.copilot");

    const settings = new SettingsStore();
    overlay = new OverlayWindow(settings);
    overlay.loadApp();
    overlay.startTracking();

    tray = createTray(overlay);
  });

  // This is a tray-resident app: closing or hiding the overlay must not quit it.
  app.on("window-all-closed", () => {});

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    overlay?.destroy();
    overlay = null;
    tray?.destroy();
    tray = null;
  });
}
