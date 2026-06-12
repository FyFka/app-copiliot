import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { OverlayController, OVERLAY_WINDOW_OPTS } from "./shared/lib/overlay/index";
import type { ChatPayload, ChatResponse } from "./types";
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

    ipcMain.handle("ask-ai", async (event, payload: ChatPayload): Promise<ChatResponse> => {
      const { messages, model, apiKey } = payload;
      try {
        if (model.startsWith("gemini")) {
          const modelId = model.includes("/") ? model.split("/").pop() : model;

          const contents = messages
            .filter((m: any) => m.role !== "system")
            .map((m: any) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));

          const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${apiKey}`;

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: contents,
            }),
          });

          const data = await response.json();

          if (!response.ok || data.error) {
            console.error("Gemini Raw Error:", data);
            throw new Error(data.error?.message || `API Error: ${response.status}`);
          }

          const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
          return { content: resultText };
        } else {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model,
              messages: messages,
            }),
          });

          const data = await response.json();
          if (data.error) throw new Error(data.error.message);
          return { content: data.choices[0].message.content };
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return { content: "", error: errorMessage };
      }
    });
  }

  loadApp() {
    if (app.isPackaged) {
      const indexPath = path.join(__dirname, "..", "renderer", "index.html");
      console.log("Loading file:", indexPath);

      this.window.loadFile(indexPath).catch((err) => {
        console.error("Failed to load file:", err);
      });
    } else {
      this.window.loadURL("http://127.0.0.1:5173/");
    }
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
    OverlayController.attachByTitle(this.window, windowTitle, { hasTitleBarOnMac: true });
  }
}
