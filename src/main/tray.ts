import { app, Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import type { OverlayWindow } from "./overlay-window.js";

/**
 * `app.getAppPath()` is the project root in development and the asar root once
 * packaged, so bundled assets resolve the same way in both.
 */
export function assetPath(...segments: string[]): string {
  return path.join(app.getAppPath(), "assets", ...segments);
}

export function createTray(overlay: OverlayWindow): Tray {
  // An empty nativeImage produces an invisible tray entry on Windows, so load
  // the real icon and only fall back if it is somehow missing.
  let icon = nativeImage.createFromPath(assetPath("tray.png"));
  if (icon.isEmpty()) {
    console.error("tray: icon asset missing, falling back to an empty image");
    icon = nativeImage.createEmpty();
  }

  const tray = new Tray(icon);
  tray.setToolTip("App Copilot");

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: overlay.getVisible() ? "Hide overlay" : "Show overlay",
        accelerator: "CommandOrControl+Shift+Space",
        click: () => overlay.toggleVisibility(),
      },
      {
        label: "Focus overlay",
        accelerator: "CommandOrControl+Shift+A",
        click: () => overlay.toggleInteraction(),
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]);

  // Rebuilt on open so the show/hide label matches the current state.
  tray.on("click", () => tray.popUpContextMenu(buildMenu()));
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
  tray.on("double-click", () => overlay.toggleVisibility());
  tray.setContextMenu(buildMenu());

  return tray;
}
