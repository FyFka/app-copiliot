import { app, BrowserWindow, globalShortcut, ipcMain, shell } from "electron";
import { OverlayController, OVERLAY_WINDOW_OPTS } from "./shared/lib/overlay/index.js";
import type {
  ActiveWindowContext,
  ChatRequest,
  ChatResult,
  Message,
  ProviderId,
  PublicSettings,
  Settings,
} from "./types.js";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import activeWin from "active-win";
import { SettingsStore } from "./settings.js";
import { streamChat } from "./ai/chat.js";
import { getProvider, isProviderId, PROVIDERS } from "./ai/providers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TRACKING_INTERVAL_MS = 1000;
/** Keeps a runaway conversation from blowing past the model's context window. */
const MAX_HISTORY_MESSAGES = 40;

const TOGGLE_VISIBILITY_ACCELERATOR = "CommandOrControl+Shift+Space";
const TOGGLE_INTERACTION_ACCELERATOR = "CommandOrControl+Shift+A";

export class OverlayWindow {
  readonly window: BrowserWindow;

  private settings: SettingsStore;
  private isVisible = false;
  private isInteractable = false;
  private context: ActiveWindowContext = { title: "", app: "" };
  private trackingTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, AbortController>();

  constructor(settings: SettingsStore) {
    this.settings = settings;
    this.window = new BrowserWindow({
      ...OVERLAY_WINDOW_OPTS,
      width: 800,
      height: 600,
      webPreferences: {
        spellcheck: false,
        preload: path.join(__dirname, "preload.js"),
        // The renderer talks to the main process only over the preload bridge,
        // so it never needs Node itself.
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Start fully transparent to clicks; the renderer turns this off while the
    // pointer is over the panel. `forward` keeps mousemove flowing to the
    // renderer even while clicks pass through, which is what makes that work.
    this.setClickThrough(true);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // A renderer reload resets its local state, so replay the authoritative
    // values instead of leaving the panel out of sync with the main process.
    this.window.webContents.on("did-finish-load", () => {
      this.send("visibility:change", this.isVisible);
      this.send("context:change", this.context);
    });

    this.blockExternalNavigation();
    this.setupIpc();
    this.registerShortcuts();
  }

  /** An overlay should never navigate itself away from the app it hosts. */
  private blockExternalNavigation() {
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });

    this.window.webContents.on("will-navigate", (event, url) => {
      const devServerUrl = process.env.VITE_DEV_SERVER_URL;
      const isDevServer = Boolean(devServerUrl) && url.startsWith(devServerUrl as string);
      if (!isDevServer && !url.startsWith("file://")) {
        event.preventDefault();
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      }
    });
  }

  private send(channel: string, ...args: unknown[]) {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(channel, ...args);
  }

  private setClickThrough(enabled: boolean) {
    this.window.setIgnoreMouseEvents(enabled, enabled ? { forward: true } : undefined);
  }

  // -------------------------------------------------------------------------
  // Visibility & interaction
  // -------------------------------------------------------------------------

  setVisible(visible: boolean) {
    if (this.isVisible === visible) return;
    this.isVisible = visible;

    if (visible) {
      // The controller hides the OS window whenever the target loses focus, so
      // showing the panel again has to bring the window back with it.
      if (!this.window.isVisible()) {
        this.window.showInactive();
        this.window.setAlwaysOnTop(true, "screen-saver");
      }
    } else {
      // A hidden panel must never eat clicks meant for the app underneath.
      this.setInteractable(false);
      this.setClickThrough(true);
    }

    this.send("visibility:change", visible);
  }

  toggleVisibility() {
    this.setVisible(!this.isVisible);
  }

  getVisible(): boolean {
    return this.isVisible;
  }

  setInteractable(interactable: boolean) {
    if (interactable && !this.isVisible) return;
    this.isInteractable = interactable;

    try {
      if (interactable) {
        this.setClickThrough(false);
        OverlayController.activateOverlay();
      } else {
        OverlayController.focusTarget();
        this.setClickThrough(true);
      }
    } catch (error) {
      // activateOverlay throws until the overlay has attached to a window.
      console.error("overlay: could not change focus", error);
    }
  }

  toggleInteraction() {
    if (!this.isVisible) {
      // Nothing to interact with yet — show the panel first.
      this.setVisible(true);
      this.setInteractable(true);
      return;
    }
    this.setInteractable(!this.isInteractable);
  }

  // -------------------------------------------------------------------------
  // Foreground window tracking
  // -------------------------------------------------------------------------

  startTracking() {
    const tick = async () => {
      try {
        const win = await activeWin();
        // Skip our own overlay: attaching to it would detach us from the app
        // the user is actually working in.
        if (!win?.title || win.owner?.processId === process.pid) return;

        if (this.context.title === win.title) return;
        this.context = { title: win.title, app: win.owner?.name ?? "" };
        this.send("context:change", this.context);
        this.attachOnWindow(win.title);
      } catch (error) {
        console.error("tracking: could not read the active window", error);
      }
    };

    void tick();
    this.trackingTimer = setInterval(() => void tick(), TRACKING_INTERVAL_MS);
  }

  stopTracking() {
    if (this.trackingTimer) clearInterval(this.trackingTimer);
    this.trackingTimer = null;
  }

  private attachOnWindow(windowTitle: string) {
    try {
      OverlayController.attachByTitle(this.window, windowTitle, { hasTitleBarOnMac: true });
    } catch (error) {
      console.error("overlay: could not attach to the active window", error);
    }
  }

  // -------------------------------------------------------------------------
  // Shortcuts
  // -------------------------------------------------------------------------

  private registerShortcuts() {
    globalShortcut.unregisterAll();

    const register = (accelerator: string, handler: () => void) => {
      // Electron accelerators must not contain spaces ("CmdOrCtrl + 1" never
      // binds), and registration fails silently when another app owns the combo.
      if (!globalShortcut.register(accelerator, handler)) {
        console.error(`shortcuts: could not register ${accelerator} — another app probably owns it`);
      }
    };

    register(TOGGLE_VISIBILITY_ACCELERATOR, () => this.toggleVisibility());
    register(TOGGLE_INTERACTION_ACCELERATOR, () => this.toggleInteraction());
  }

  // -------------------------------------------------------------------------
  // IPC
  // -------------------------------------------------------------------------

  private setupIpc() {
    ipcMain.handle("overlay:set-click-through", (_event, enabled: unknown) => {
      // While the user has explicitly grabbed the overlay, hover must not hand
      // clicks back to the app underneath.
      if (this.isInteractable) return;
      this.setClickThrough(Boolean(enabled));
    });

    ipcMain.handle("overlay:hide", () => this.setVisible(false));

    ipcMain.handle("providers:list", () => PROVIDERS);
    ipcMain.handle("context:get", () => this.context);
    ipcMain.handle("settings:get", () => this.settings.toPublic());

    ipcMain.handle("settings:set", (_event, patch: Partial<Settings>): PublicSettings => {
      return this.settings.update(patch ?? {});
    });

    ipcMain.handle("settings:set-api-key", (_event, provider: unknown, key: unknown): PublicSettings => {
      if (!isProviderId(provider)) return this.settings.toPublic();
      return this.settings.setApiKey(provider, typeof key === "string" ? key : "");
    });

    ipcMain.handle("chat:abort", (_event, requestId: unknown) => {
      if (typeof requestId !== "string") return;
      this.pending.get(requestId)?.abort();
    });

    ipcMain.handle("chat:send", (_event, request: ChatRequest) => this.ask(request));
  }

  private buildSystemPrompt(settings: Settings): string {
    const parts = [settings.systemPrompt.trim()].filter(Boolean);

    if (settings.shareContext && this.context.title) {
      const owner = this.context.app ? ` (${this.context.app})` : "";
      parts.push(`The user's currently focused window is: "${this.context.title}"${owner}.`);
    }

    return parts.join("\n\n");
  }

  private async ask(request: ChatRequest): Promise<ChatResult> {
    const { requestId, messages } = request ?? {};

    if (typeof requestId !== "string" || !Array.isArray(messages) || messages.length === 0) {
      return { content: "", error: "Malformed chat request" };
    }
    if (this.pending.has(requestId)) {
      return { content: "", error: "That request is already running" };
    }

    const settings = this.settings.get();
    const provider: ProviderId = settings.provider;
    const apiKey = this.settings.getApiKey(provider);

    if (!apiKey) {
      return { content: "", error: `Add an API key for ${getProvider(provider).label} in settings` };
    }
    if (provider === "custom" && !settings.customBaseUrl) {
      return { content: "", error: "Set a base URL for the OpenAI-compatible endpoint in settings" };
    }
    if (!settings.model.trim()) {
      return { content: "", error: "Pick a model in settings" };
    }

    const controller = new AbortController();
    this.pending.set(requestId, controller);

    try {
      const history: Message[] = messages.slice(-MAX_HISTORY_MESSAGES);
      const content = await streamChat({
        provider,
        model: settings.model,
        apiKey,
        customBaseUrl: settings.customBaseUrl,
        systemPrompt: this.buildSystemPrompt(settings),
        messages: history,
        signal: controller.signal,
        onDelta: (delta) => this.send("chat:delta", { requestId, delta }),
      });

      return { content };
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return { content: "", aborted: true };
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("chat: request failed", error);
      return { content: "", error: message };
    } finally {
      this.pending.delete(requestId);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  loadApp() {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;

    if (!app.isPackaged && devServerUrl) {
      this.window.loadURL(devServerUrl).catch((error) => {
        console.error("renderer: could not reach the dev server", error);
      });
      return;
    }

    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    this.window.loadFile(indexPath).catch((error) => {
      console.error("renderer: could not load", indexPath, error);
    });
  }

  destroy() {
    this.stopTracking();
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}
