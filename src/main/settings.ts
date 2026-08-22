import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ProviderId, PublicSettings, Settings } from "./types.js";
import { isProviderId, normalizeBaseUrl, PROVIDER_IDS } from "./ai/providers.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are App Copilot, an assistant living in an overlay on top of the user's desktop. " +
  "Answer concisely and practically. When the user's focused window is provided, use it as " +
  "context for what they are working on, but do not mention it unless it is relevant.";

const DEFAULTS: Settings = {
  provider: "openai",
  model: "gpt-4o",
  customBaseUrl: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  shareContext: true,
};

interface StoredFile {
  settings: Partial<Settings>;
  /** provider id -> base64 of the safeStorage-encrypted key. */
  keys: Partial<Record<ProviderId, string>>;
}

export class SettingsStore {
  private settings: Settings = { ...DEFAULTS };
  private keys = new Map<ProviderId, string>();
  private file: string;

  constructor() {
    this.file = path.join(app.getPath("userData"), "settings.json");
    this.load();
  }

  private get canEncrypt(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private load() {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf-8");
    } catch {
      return; // First run — defaults are already in place.
    }

    let parsed: StoredFile;
    try {
      parsed = JSON.parse(raw) as StoredFile;
    } catch (error) {
      console.error("settings: ignoring unreadable settings file", error);
      return;
    }

    this.settings = this.sanitize({ ...DEFAULTS, ...parsed.settings });

    if (!this.canEncrypt) return;
    for (const [provider, encrypted] of Object.entries(parsed.keys ?? {})) {
      if (!isProviderId(provider) || typeof encrypted !== "string") continue;
      try {
        this.keys.set(provider, safeStorage.decryptString(Buffer.from(encrypted, "base64")));
      } catch (error) {
        // Usually means the OS keychain/user profile changed — drop the key and
        // let the user re-enter it rather than failing to start.
        console.error(`settings: could not decrypt the ${provider} key`, error);
      }
    }
  }

  private save() {
    const keys: Partial<Record<ProviderId, string>> = {};
    if (this.canEncrypt) {
      for (const [provider, key] of this.keys) {
        try {
          keys[provider] = safeStorage.encryptString(key).toString("base64");
        } catch (error) {
          console.error(`settings: could not encrypt the ${provider} key`, error);
        }
      }
    }

    const payload: StoredFile = { settings: this.settings, keys };
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf-8");
      fs.renameSync(temp, this.file); // Atomic — never leaves a half-written file.
    } catch (error) {
      console.error("settings: could not save", error);
    }
  }

  private sanitize(settings: Settings): Settings {
    return {
      provider: isProviderId(settings.provider) ? settings.provider : DEFAULTS.provider,
      model: typeof settings.model === "string" && settings.model.trim() ? settings.model.trim() : DEFAULTS.model,
      customBaseUrl: typeof settings.customBaseUrl === "string" ? normalizeBaseUrl(settings.customBaseUrl) : "",
      systemPrompt: typeof settings.systemPrompt === "string" ? settings.systemPrompt : DEFAULTS.systemPrompt,
      shareContext: typeof settings.shareContext === "boolean" ? settings.shareContext : DEFAULTS.shareContext,
    };
  }

  get(): Settings {
    return { ...this.settings };
  }

  getApiKey(provider: ProviderId): string {
    return this.keys.get(provider) ?? "";
  }

  /** The renderer-safe view: everything except the keys themselves. */
  toPublic(): PublicSettings {
    const savedKeys = Object.fromEntries(
      PROVIDER_IDS.map((provider) => [provider, Boolean(this.keys.get(provider))]),
    ) as Record<ProviderId, boolean>;

    return { ...this.settings, savedKeys, secureStorage: this.canEncrypt };
  }

  update(patch: Partial<Settings>): PublicSettings {
    this.settings = this.sanitize({ ...this.settings, ...patch });
    this.save();
    return this.toPublic();
  }

  setApiKey(provider: ProviderId, key: string): PublicSettings {
    const trimmed = key.trim();
    if (trimmed) {
      this.keys.set(provider, trimmed);
    } else {
      this.keys.delete(provider);
    }
    this.save();
    return this.toPublic();
  }
}
