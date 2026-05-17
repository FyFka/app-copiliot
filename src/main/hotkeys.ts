import { globalShortcut } from "electron";
import { GlobalKeyboardListener } from "node-global-key-listener";

export type HotkeyHandler = () => void;

function isCtrlDown(down: Record<string, boolean>): boolean {
  return Boolean(
    down["LEFT CTRL"] ||
      down["RIGHT CTRL"] ||
      down["CONTROL"] ||
      down["CTRL"] ||
      down["LEFT CONTROL"] ||
      down["RIGHT CONTROL"],
  );
}

function isAltDown(down: Record<string, boolean>): boolean {
  return Boolean(
    down["LEFT ALT"] ||
      down["RIGHT ALT"] ||
      down["ALT"] ||
      down["LEFT ALT KEY"] ||
      down["RIGHT ALT KEY"],
  );
}

/** Electron globalShortcut (may be blocked if another app registered the same combo). */
export function registerElectronShortcuts(onToggle: HotkeyHandler): void {
  const accelerators = [
    "CommandOrControl+B",
    "CommandOrControl+Shift+B",
    "Control+Alt+B",
    "Control+Alt+Space",
  ] as const;

  for (const accelerator of accelerators) {
    const ok = globalShortcut.register(accelerator, onToggle);
    console.log(
      `[app-copilot] globalShortcut ${accelerator}:`,
      ok ? "registered" : "FAILED",
    );
  }
}

/**
 * Low-level keyboard hook — works when Electron globalShortcut does not fire
 * (common on Windows when another app owns Ctrl+B globally).
 */
export function registerSystemKeyboardHook(onToggle: HotkeyHandler): void {
  const listener = new GlobalKeyboardListener({
    windows: {
      onError: (code) => console.error("[app-copilot] keyboard hook error:", code),
      onInfo: (info) => console.info("[app-copilot] keyboard hook:", info),
    },
  });

  listener.addListener((event, down) => {
    if (event.state !== "DOWN") return;

    const ctrl = isCtrlDown(down);
    const alt = isAltDown(down);

    if (ctrl && event.name === "B") {
      onToggle();
      return;
    }

    if (ctrl && alt && (event.name === "B" || event.name === "SPACE")) {
      onToggle();
    }
  });

  console.log(
    "[app-copilot] System keyboard hook active (Ctrl+B, Ctrl+Alt+B, Ctrl+Alt+Space)",
  );
}
