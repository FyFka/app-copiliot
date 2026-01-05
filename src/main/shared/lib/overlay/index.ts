/**
 * index.ts
 *
 * Public entry point for the overlay-window
 *
 */

import { EventEmitter } from "node:events";
import { join } from "node:path";
import { throttle } from "throttle-debounce";
import { screen, BrowserWindow } from "electron";
import type { Rectangle, BrowserWindowConstructorOptions } from "electron";

// Native addon

interface AddonExports {
  start(overlayWindowId: Buffer | undefined, targetWindowTitle: string, cb: (e: unknown) => void): void;
  activateOverlay(): void;
  focusTarget(): void;
  screenshot(): Buffer;
}

const lib: AddonExports = require("node-gyp-build")(join(__dirname, ".."));

//  Event type constants (must match overlay_window.h)

const enum EventType {
  ATTACH = 1,
  FOCUS = 2,
  BLUR = 3,
  DETACH = 4,
  FULLSCREEN = 5,
  MOVERESIZE = 6,
}

// Public event payload types

export interface AttachEvent {
  /** `undefined` on non-Windows platforms */
  hasAccess: boolean | undefined;
  /** `undefined` on non-Linux platforms */
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

export interface OverlayWindowEvents {
  attach: (e: AttachEvent) => void;
  focus: () => void;
  blur: () => void;
  detach: () => void;
  fullscreen: (e: FullscreenEvent) => void;
  moveresize: (e: MoveresizeEvent) => void;
}

// Options

export interface AttachOptions {
  /**
   * Set to `true` if the tracked window has a native title bar on macOS.
   * The overlay will be shifted down / shrunk to avoid covering it.
   */
  hasTitleBarOnMac?: boolean;
}

// Recommended BrowserWindow options for the overlay window

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

export const OVERLAY_WINDOW_OPTS: BrowserWindowConstructorOptions = {
  fullscreenable: true,
  skipTaskbar: !isLinux,
  frame: false,
  show: false,
  transparent: true,
  resizable: !isLinux, // let Chromium accept OS-driven size changes
  hasShadow: !isMac, // disable shadow on macOS
  alwaysOnTop: isMac, // float above all windows on macOS
};

// Controller

class OverlayControllerGlobal {
  private isInitialized = false;
  private electronWindow?: BrowserWindow;

  /**
   * Most recently reported client-area bounds of the target window.
   * On Windows and XWayland this is the physical (non-DIP) rectangle.
   */
  targetBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  /** Whether the target window currently has OS focus. */
  targetHasFocus = false;

  private focusNext: "overlay" | "target" | undefined;

  /** Height of a standard macOS title bar, measured lazily once on attach. */
  private macTitleBarHeight = 0;

  private attachOptions: AttachOptions = {};

  // Typed event emitter exposed as a narrow on/off API (see below)
  private readonly _events = new EventEmitter();

  // ── Typed event subscription API ────────────────────────────────────────────

  on<K extends keyof OverlayWindowEvents>(event: K, listener: OverlayWindowEvents[K]): this {
    this._events.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof OverlayWindowEvents>(event: K, listener: OverlayWindowEvents[K]): this {
    this._events.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof OverlayWindowEvents>(event: K, listener: OverlayWindowEvents[K]): this {
    this._events.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  // Internal setup

  constructor() {
    this._events.on("attach", (e: AttachEvent) => {
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

    this._events.on("fullscreen", (e: FullscreenEvent) => {
      this.handleFullscreen(e.isFullscreen);
    });

    this._events.on("detach", () => {
      this.targetHasFocus = false;
      this.electronWindow?.hide();
    });

    const dispatchMoveresize = throttle(34 /* ≈30 fps */, () => {
      this.updateOverlayBounds();
    });

    this._events.on("moveresize", (e: MoveresizeEvent) => {
      this.targetBounds = e;
      dispatchMoveresize();
    });

    this._events.on("blur", () => {
      this.targetHasFocus = false;

      if (this.electronWindow && (isMac || (this.focusNext !== "overlay" && !this.electronWindow.isFocused()))) {
        this.electronWindow.hide();
      }
    });

    this._events.on("focus", () => {
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

  //Fullscreen handling

  private handleFullscreen(isFullscreen: boolean): void {
    if (!this.electronWindow) return;

    if (isMac) {
      // On macOS only one app can own the native fullscreen space.
      // We work around this by showing the overlay on all workspaces.
      // https://github.com/electron/electron/issues/10078#issuecomment-754105005
      this.electronWindow.setVisibleOnAllWorkspaces(isFullscreen, {
        visibleOnFullScreen: true,
      });

      if (isFullscreen) {
        this.electronWindow.setBounds(screen.getPrimaryDisplay().bounds);
      } else {
        this.updateOverlayBounds();
      }
    }
  }

  // Bounds calculation

  private updateOverlayBounds(): void {
    let lastBounds = this.adjustBoundsForMacTitleBar(this.targetBounds);

    if (lastBounds.width === 0 || lastBounds.height === 0) return;
    if (!this.electronWindow) return;

    if (process.platform === "win32") {
      lastBounds = screen.screenToDipRect(this.electronWindow, lastBounds);
      this.electronWindow.setBounds(lastBounds);

      lastBounds = screen.screenToDipRect(this.electronWindow, lastBounds);
      this.electronWindow.setBounds(lastBounds);
    } else if (isLinux) {
      const tl = screen.screenToDipPoint({ x: lastBounds.x, y: lastBounds.y });
      const br = screen.screenToDipPoint({ x: lastBounds.x + lastBounds.width, y: lastBounds.y + lastBounds.height });
      lastBounds = { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
      this.electronWindow.setBounds(lastBounds);
    } else {
      this.electronWindow.setBounds(lastBounds);
    }
  }

  // Native event dispatch

  private handler(e: unknown): void {
    const event = e as { type: EventType };
    switch (event.type) {
      case EventType.ATTACH:
        this._events.emit("attach", e);
        break;
      case EventType.FOCUS:
        this._events.emit("focus", e);
        break;
      case EventType.BLUR:
        this._events.emit("blur", e);
        break;
      case EventType.DETACH:
        this._events.emit("detach", e);
        break;
      case EventType.FULLSCREEN:
        this._events.emit("fullscreen", e);
        break;
      case EventType.MOVERESIZE:
        this._events.emit("moveresize", e);
        break;
    }
  }

  // macOS title bar measurement

  private calculateMacTitleBarHeight(): void {
    const testWindow = new BrowserWindow({
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });
    this.macTitleBarHeight = testWindow.getSize()[1] - testWindow.getContentSize()[1];
    testWindow.destroy();
  }

  private adjustBoundsForMacTitleBar(bounds: Rectangle): Rectangle {
    if (!isMac || !this.attachOptions.hasTitleBarOnMac) {
      return bounds;
    }
    return {
      ...bounds,
      y: bounds.y + this.macTitleBarHeight,
      height: bounds.height - this.macTitleBarHeight,
    };
  }

  // Public API

  activateOverlay(): void {
    if (!this.electronWindow) {
      throw new Error("activateOverlay() is not available in tracking mode.");
    }
    this.focusNext = "overlay";
    this.electronWindow.setIgnoreMouseEvents(false);

    if (isLinux) {
      lib.activateOverlay();
    } else {
      this.electronWindow.focus();
    }
  }

  focusTarget(): void {
    this.focusNext = "target";
    this.electronWindow?.setIgnoreMouseEvents(true);
    lib.focusTarget();
  }

  /**
   * Start tracking `targetWindowTitle`.
   *
   * @param electronWindow  The overlay BrowserWindow, or `undefined` for
   *                        tracking-only mode (no overlay will be shown).
   * @param targetWindowTitle  Exact, case-sensitive window title to track.
   * @param options  Additional attach options.
   */
  attachByTitle(
    electronWindow: BrowserWindow | undefined,
    targetWindowTitle: string,
    options: AttachOptions = {},
  ): void {
    if (this.isInitialized) {
      throw new Error("OverlayController can only be initialized once.");
    }
    this.isInitialized = true;
    this.electronWindow = electronWindow;
    this.attachOptions = options;

    // In tracking mode (no electronWindow) these listeners are intentionally
    // skipped – there is no window to show/hide.
    if (this.electronWindow) {
      this.electronWindow.on("blur", () => {
        if (!this.targetHasFocus && this.focusNext !== "target") {
          this.electronWindow!.hide();
        }
      });

      this.electronWindow.on("focus", () => {
        this.focusNext = undefined;
      });

      if (isMac) {
        this.calculateMacTitleBarHeight();
      }
    }

    lib.start(this.electronWindow?.getNativeWindowHandle(), targetWindowTitle, this.handler.bind(this));
  }

  /**
   * Capture the target window's client area as a raw BGRA bitmap.
   * Suitable for use with `nativeImage.createFromBitmap`.
   *
   * Only implemented on Windows.
   */
  screenshot(): Buffer {
    if (process.platform !== "win32") {
      throw new Error("screenshot() is not implemented on this platform.");
    }
    return lib.screenshot();
  }
}

export const OverlayController = new OverlayControllerGlobal();
