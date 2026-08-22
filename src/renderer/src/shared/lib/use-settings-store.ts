import { create } from "zustand";
import { copilotApi } from "./copilot";
import type { ProviderId, ProviderInfo, PublicSettings, Settings } from "../model/types";

const EMPTY_SETTINGS: PublicSettings = {
  provider: "openai",
  model: "gpt-4o",
  customBaseUrl: "",
  systemPrompt: "",
  shareContext: true,
  savedKeys: { openai: false, gemini: false, deepseek: false, custom: false },
  secureStorage: false,
};

interface SettingsState {
  settings: PublicSettings;
  providers: ProviderInfo[];
  isLoaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  setApiKey: (provider: ProviderId, key: string) => Promise<void>;
}

/**
 * Settings live in the main process — API keys are stored there encrypted and
 * are never sent to the renderer, so this store only mirrors the safe fields.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: EMPTY_SETTINGS,
  providers: [],
  isLoaded: false,

  load: async () => {
    const [settings, providers] = await Promise.all([copilotApi.getSettings(), copilotApi.getProviders()]);
    set({ settings, providers, isLoaded: true });
  },

  update: async (patch) => {
    const settings = await copilotApi.setSettings(patch);
    set({ settings });
  },

  setApiKey: async (provider, key) => {
    const settings = await copilotApi.setApiKey(provider, key);
    set({ settings });
  },
}));

export const findProvider = (providers: ProviderInfo[], id: ProviderId): ProviderInfo | undefined =>
  providers.find((provider) => provider.id === id);
