import { EventEmitter } from "node:events";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { throttle } from "throttle-debounce";
import { screen } from "electron";
import { BrowserWindow, Rectangle, BrowserWindowConstructorOptions } from "electron";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let addonPath = join(__dirname, "..");
if (__dirname.includes("dist") && !existsSync(join(addonPath, "build")) && !existsSync(join(addonPath, "prebuilds"))) {
  const srcPath = join(__dirname, "../../../../../src/main/shared/lib");
  if (existsSync(join(srcPath, "build")) || existsSync(join(srcPath, "prebuilds"))) {
    addonPath = srcPath;
  } else {
    addonPath = join(__dirname, "../../../../..");
  }
}

const lib: AddonExports = require("node-gyp-build")(addonPath);

interface AddonExports {
  start(overlayWindowId: Buffer | undefined, targetWindowTitle: string, cb: (e: any) => void): void;

  activateOverlay(): void;
  focusTarget(): void;
  screenshot(): Buffer;
}

enum EventType {
  EVENT_ATTACH = 1,
  EVENT_FOCUS = 2,
  EVENT_BLUR = 3,
  EVENT_DETACH = 4,
  EVENT_FULLSCREEN = 5,
  EVENT_MOVERESIZE = 6,
}

export interface AttachEvent {
  hasAccess: boolean | undefined;
  isFullscreen: boolean | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FullscreenEvent {
  isFullscreen: boolean;
}

export interface MoveresizeEvent {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AttachOptions {
  hasTitleBarOnMac?: boolean;
}

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

export const OVERLAY_WINDOW_OPTS: BrowserWindowConstructorOptions = {
  fullscreenable: true,
  skipTaskbar: !isLinux,
  frame: false,
  show: false,
  transparent: true,
  resizable: !isLinux,
  hasShadow: !isMac,
  alwaysOnTop: isMac,
};

class OverlayControllerGlobal {
  private isInitialized = false;
  private electronWindow?: BrowserWindow;
  targetBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  targetHasFocus = false;
  private focusNext: "overlay" | "target" | undefined;
  private macTitleBarHeight = 0;
  private attachOptions: AttachOptions = {};

  readonly events = new EventEmitter();

  constructor() {
    this.events.on("attach", (e: AttachEvent) => {
      this.targetHasFocus = true;
      if (this.electronWindow) {
        this.electronWindow.setIgnoreMouseEvents(true);
        this.electronWindow.showInactive();
        this.electronWindow.setAlwaysOnTop(true, "screen-saver");
      }
      if (e.isFullscreen !== undefined) {
        this.handleFullscreen(e.isFullscreen);
      }
      this.targetBounds = e;
      this.updateOverlayBounds();
    });

    this.events.on("fullscreen", (e: FullscreenEvent) => {
      this.handleFullscreen(e.isFullscreen);
    });

    this.events.on("detach", () => {
      this.targetHasFocus = false;
      this.electronWindow?.hide();
    });

    const dispatchMoveresize = throttle(34 /* 30fps */, this.updateOverlayBounds.bind(this));

    this.events.on("moveresize", (e: MoveresizeEvent) => {
      this.targetBounds = e;
      dispatchMoveresize();
    });

    this.events.on("blur", () => {
      this.targetHasFocus = false;

      if (this.electronWindow && (isMac || (this.focusNext !== "overlay" && !this.electronWindow.isFocused()))) {
        this.electronWindow.hide();
      }
    });

    this.events.on("focus", () => {
      this.focusNext = undefined;
      this.targetHasFocus = true;

      if (this.electronWindow) {
        this.electronWindow.setIgnoreMouseEvents(true);
        if (!this.electronWindow.isVisible()) {
          this.electronWindow.showInactive();
          this.electronWindow.setAlwaysOnTop(true, "screen-saver");
        }
      }
    });
  }

  private async handleFullscreen(isFullscreen: boolean) {
    if (!this.electronWindow) return;

    if (isMac) {
      this.electronWindow.setVisibleOnAllWorkspaces(isFullscreen, { visibleOnFullScreen: true });
      if (isFullscreen) {
        const display = screen.getPrimaryDisplay();
        this.electronWindow.setBounds(display.bounds);
      } else {
        this.updateOverlayBounds();
      }
    }
  }

  private updateOverlayBounds() {
    let lastBounds = this.adjustBoundsForMacTitleBar(this.targetBounds);
    if (lastBounds.width === 0 || lastBounds.height === 0) return;
    if (!this.electronWindow) return;

    if (process.platform === "win32") {
      lastBounds = screen.screenToDipRect(this.electronWindow, this.targetBounds);
    } else if (isLinux) {
      const tl = screen.screenToDipPoint({ x: lastBounds.x, y: lastBounds.y });
      const logicalSize = screen.screenToDipPoint({ x: lastBounds.width, y: lastBounds.height });
      lastBounds = { x: tl.x, y: tl.y, width: logicalSize.x, height: logicalSize.y };
    }
    this.electronWindow.setBounds(lastBounds);

    if (process.platform === "win32") {
      lastBounds = screen.screenToDipRect(this.electronWindow, this.targetBounds);
      this.electronWindow.setBounds(lastBounds);
    }
  }

  private handler(e: unknown) {
    switch ((e as { type: EventType }).type) {
      case EventType.EVENT_ATTACH:
        this.events.emit("attach", e);
        break;
      case EventType.EVENT_FOCUS:
        this.events.emit("focus", e);
        break;
      case EventType.EVENT_BLUR:
        this.events.emit("blur", e);
        break;
      case EventType.EVENT_DETACH:
        this.events.emit("detach", e);
        break;
      case EventType.EVENT_FULLSCREEN:
        this.events.emit("fullscreen", e);
        break;
      case EventType.EVENT_MOVERESIZE:
        this.events.emit("moveresize", e);
        break;
    }
  }

  private calculateMacTitleBarHeight() {
    const testWindow = new BrowserWindow({
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: true,
      },
      show: false,
    });
    const fullHeight = testWindow.getSize()[1];
    const contentHeight = testWindow.getContentSize()[1];
    this.macTitleBarHeight = fullHeight - contentHeight;
    testWindow.close();
  }

  private adjustBoundsForMacTitleBar(bounds: Rectangle) {
    if (!isMac || !this.attachOptions.hasTitleBarOnMac) {
      return bounds;
    }

    const newBounds: Rectangle = {
      ...bounds,
      y: bounds.y + this.macTitleBarHeight,
      height: bounds.height - this.macTitleBarHeight,
    };
    return newBounds;
  }

  activateOverlay() {
    if (!this.electronWindow) {
      throw new Error("You are using the library in tracking mode");
    }
    this.focusNext = "overlay";
    this.electronWindow.setIgnoreMouseEvents(false);
    if (isLinux) {
      lib.activateOverlay();
    } else {
      this.electronWindow.focus();
    }
  }

  focusTarget() {
    this.focusNext = "target";
    this.electronWindow?.setIgnoreMouseEvents(true);
    lib.focusTarget();
  }

  attachByTitle(electronWindow: BrowserWindow | undefined, targetWindowTitle: string, options: AttachOptions = {}) {
    this.isInitialized = true;

    this.electronWindow = electronWindow;

    this.electronWindow?.removeAllListeners("blur");
    this.electronWindow?.removeAllListeners("focus");

    this.electronWindow?.on("blur", () => {
      if (!this.targetHasFocus && this.focusNext !== "target") {
        this.electronWindow!.hide();
      }
    });

    this.electronWindow?.on("focus", () => {
      this.focusNext = undefined;
    });

    this.attachOptions = options;
    if (isMac) {
      this.calculateMacTitleBarHeight();
    }

    lib.start(this.electronWindow?.getNativeWindowHandle(), targetWindowTitle, this.handler.bind(this));
  }

  screenshot(): Buffer {
    if (process.platform !== "win32") {
      throw new Error("Not implemented on your platform.");
    }
    return lib.screenshot();
  }
}

export const OverlayController = new OverlayControllerGlobal();
