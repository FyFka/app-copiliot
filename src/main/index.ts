import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyBoundsToOverlay,
  getActiveTarget,
  type TrackedWindow,
} from "./active-target.js";
import {
  registerElectronShortcuts,
  registerSystemKeyboardHook,
} from "./hotkeys.js";
import { loadRenderer } from "./renderer-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDevSession = Boolean(process.env.VITE_DEV_SERVER_URL);

if (isDevSession) {
  app.setPath("userData", `${app.getPath("userData")}-dev`);
}

const PANEL_WIDTH = 380;
const POLL_MS = 80;
const TARGET_CACHE_MS = 150;

let overlayWindow: BrowserWindow | null = null;
let keepAliveWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let panelInteractive = false;
let trackedTarget: TrackedWindow | null = null;
let lastExternalTarget: TrackedWindow | null = null;
let boundsPollTimer: ReturnType<typeof setInterval> | null = null;
let targetCacheTimer: ReturnType<typeof setInterval> | null = null;
let logFilePath = "";

function log(...args: unknown[]): void {
  const line = `[app-copilot ${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${line}\n`);
    } catch {
      // ignore log write errors
    }
  }
}

function getPreloadPath(): string {
  return join(__dirname, "preload.js");
}

async function createOverlayWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#01000000",
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    focusable: true,
    thickFrame: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("overlay:panel-width", PANEL_WIDTH);
  });

  log(
    "Loading renderer:",
    isDevSession ? process.env.VITE_DEV_SERVER_URL : "dist/renderer (file)",
  );
  await loadRenderer(win, __dirname);
  return win;
}

async function ensureOverlayWindow(): Promise<BrowserWindow> {
  if (!overlayWindow) {
    overlayWindow = await createOverlayWindow();
  }
  return overlayWindow;
}

function setPanelInteractive(interactive: boolean): void {
  if (!overlayWindow || panelInteractive === interactive) return;
  panelInteractive = interactive;
  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  if (interactive) {
    overlayWindow.focus();
  }
}

function stopBoundsPolling(): void {
  if (boundsPollTimer) {
    clearInterval(boundsPollTimer);
    boundsPollTimer = null;
  }
}

function startBoundsPolling(): void {
  stopBoundsPolling();
  boundsPollTimer = setInterval(() => {
    void syncOverlayToTarget();
  }, POLL_MS);
}

function startTargetCachePolling(): void {
  if (targetCacheTimer) return;
  targetCacheTimer = setInterval(() => {
    void (async () => {
      if (overlayWindow?.isVisible()) return;
      const target = await getActiveTarget(process.pid);
      if (target) lastExternalTarget = target;
    })();
  }, TARGET_CACHE_MS);
}

async function resolveTargetWindow(): Promise<TrackedWindow | null> {
  const live = await getActiveTarget(process.pid);
  if (live) return live;
  if (lastExternalTarget) {
    log("Using cached target:", lastExternalTarget.title);
    return lastExternalTarget;
  }
  return null;
}

async function syncOverlayToTarget(): Promise<boolean> {
  if (!overlayWindow || !trackedTarget) return false;

  const current = await getActiveTarget(process.pid);
  if (current && current.id === trackedTarget.id) {
    trackedTarget = current;
  }

  applyBoundsToOverlay(overlayWindow, trackedTarget.bounds);
  return true;
}

async function showOverlayOnActiveWindow(): Promise<void> {
  const target = await resolveTargetWindow();
  if (!target) {
    log("No target window — focus another app, then press Ctrl+B");
    return;
  }

  trackedTarget = target;
  log("Showing overlay on:", target.title);

  const win = await ensureOverlayWindow();
  applyBoundsToOverlay(win, target.bounds);

  win.setAlwaysOnTop(true, "screen-saver");
  win.show();
  win.moveTop();
  setPanelInteractive(false);
  startBoundsPolling();
}

function hideOverlay(): void {
  stopBoundsPolling();
  trackedTarget = null;
  panelInteractive = false;
  overlayWindow?.hide();
  overlayWindow?.setIgnoreMouseEvents(true, { forward: true });
  log("Overlay hidden");
}

let toggleInProgress = false;

async function toggleOverlay(): Promise<void> {
  if (toggleInProgress) return;
  toggleInProgress = true;
  try {
    log("toggleOverlay()");
    if (overlayWindow?.isVisible()) {
      hideOverlay();
      return;
    }
    await showOverlayOnActiveWindow();
  } catch (error) {
    log("toggleOverlay error:", error);
  } finally {
    toggleInProgress = false;
  }
}

function createTrayIcon(): Electron.NativeImage {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect width="32" height="32" rx="8" fill="#7c3aed"/>
      <text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-family="Segoe UI">C</text>
    </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("App Copilot — Ctrl+B или Ctrl+Alt+B");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Показать / скрыть (Ctrl+B / Ctrl+Alt+B)",
        click: () => void toggleOverlay(),
      },
      { type: "separator" },
      { label: "Выход", click: () => app.quit() },
    ]),
  );
  tray.on("double-click", () => void toggleOverlay());
}

function registerIpc(): void {
  ipcMain.handle("overlay:set-click-through", (_event, enabled: boolean) => {
    setPanelInteractive(!enabled);
  });

  ipcMain.handle("overlay:focus-target", () => {
    hideOverlay();
  });

  ipcMain.handle("overlay:hide", () => {
    hideOverlay();
  });

  ipcMain.handle("chat:send", async (_event, text: string) => {
    const message = text.trim();
    if (!message) return { role: "assistant" as const, content: "" };

    return {
      role: "assistant" as const,
      content: `Получил ваше сообщение: «${message}». LLM-сервис будет подключён на следующем этапе.`,
    };
  });
}

function registerHotkeys(): void {
  const onToggle = () => void toggleOverlay();
  registerElectronShortcuts(onToggle);
  registerSystemKeyboardHook(onToggle);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

function createKeepAliveWindow(): void {
  keepAliveWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    frame: false,
  });
}

app.whenReady().then(() => {
  logFilePath = join(app.getPath("userData"), "copilot.log");
  log("App ready, pid=", process.pid, "log:", logFilePath);

  createKeepAliveWindow();
  registerIpc();
  createTray();
  startTargetCachePolling();
  registerHotkeys();
  log("Copilot running in tray. Use Ctrl+B or Ctrl+Alt+B.");
});

app.on("window-all-closed", () => {
  // Tray app — keep running when overlay is hidden.
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (targetCacheTimer) clearInterval(targetCacheTimer);
  stopBoundsPolling();
});
