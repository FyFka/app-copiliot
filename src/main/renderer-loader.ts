import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

export function getRendererHtmlPath(mainDirname: string): string {
  return join(mainDirname, "../renderer/index.html");
}

export async function loadRenderer(win: BrowserWindow, mainDirname: string): Promise<void> {
  const devUrl = process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, "");
  if (devUrl) {
    await win.loadURL(devUrl);
    return;
  }

  const htmlPath = getRendererHtmlPath(mainDirname);
  if (!existsSync(htmlPath)) {
    throw new Error(`Renderer not built: ${htmlPath}. Run "npm run build:renderer" first.`);
  }

  await win.loadFile(htmlPath);
}
