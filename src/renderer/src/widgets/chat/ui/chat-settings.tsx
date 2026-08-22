import { useState, type ChangeEvent } from "react";
import { ExternalLink, Check } from "lucide-react";
import { findProvider, Input, Select, useSettingsStore, type ProviderId, type SelectOption } from "@/shared";

const FIELD_CLASS =
  "rounded-2xl w-full flex gap-2 justify-between items-center border-none bg-secondary-background " +
  "px-3 py-2.5 text-sm text-foreground-primary cursor-pointer";

export const ChatSettings = () => {
  const { settings, providers, update, setApiKey } = useSettingsStore();
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const provider = findProvider(providers, settings.provider);
  const hasSavedKey = settings.savedKeys[settings.provider];

  const providerOptions: SelectOption[] = providers.map((item) => ({ value: item.id, label: item.label }));
  const modelOptions: SelectOption[] = (provider?.models ?? []).map((model) => ({
    value: model.id,
    label: model.label,
  }));

  const handleProviderChange = (value: string) => {
    const next = providers.find((item) => item.id === value);
    if (!next) return;
    // Move to a model the new provider actually serves; custom endpoints keep
    // whatever the user typed.
    const model = next.models[0]?.id ?? (next.needsBaseUrl ? settings.model : "");
    // Each provider keeps its own key, so the draft must not leak across a switch.
    setApiKeyDraft("");
    void update({ provider: value as ProviderId, model });
  };

  const handleSaveKey = () => {
    if (!apiKeyDraft.trim()) return;
    void setApiKey(settings.provider, apiKeyDraft);
    setApiKeyDraft("");
  };

  return (
    <div className="flex flex-col gap-2 p-2 bg-secondary-background rounded-xl">
      <label className="text-[10px] uppercase tracking-wide text-foreground">Provider</label>
      <Select
        options={providerOptions}
        value={settings.provider}
        onChange={handleProviderChange}
        placeholder="Select provider"
        btnClass={FIELD_CLASS}
      />

      <label className="text-[10px] uppercase tracking-wide text-foreground">Model</label>
      {provider?.needsBaseUrl ? (
        <Input
          value={settings.model}
          onChange={(event: ChangeEvent<HTMLInputElement>) => void update({ model: event.target.value })}
          placeholder="Model name"
          label="Model"
        />
      ) : (
        <Select
          options={modelOptions}
          value={settings.model}
          onChange={(value) => void update({ model: value })}
          placeholder="Select model"
          btnClass={FIELD_CLASS}
        />
      )}

      {provider?.needsBaseUrl && (
        <Input
          value={settings.customBaseUrl}
          onChange={(event: ChangeEvent<HTMLInputElement>) => void update({ customBaseUrl: event.target.value })}
          placeholder="https://host/v1"
          label="Base URL"
        />
      )}

      <label className="text-[10px] uppercase tracking-wide text-foreground flex items-center gap-1">
        API key
        {hasSavedKey && (
          <span className="text-foreground-primary/70 inline-flex items-center gap-0.5">
            <Check size={10} /> saved
          </span>
        )}
      </label>
      <div className="flex gap-2 items-center">
        <Input
          type="password"
          value={apiKeyDraft}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setApiKeyDraft(event.target.value)}
          placeholder={hasSavedKey ? "•••••••• stored" : "Paste your API key"}
        />
        <button
          type="button"
          onClick={handleSaveKey}
          disabled={!apiKeyDraft.trim()}
          className="px-3 py-2.5 rounded-2xl bg-primary-foreground text-background text-xs font-medium disabled:opacity-40 cursor-pointer"
        >
          Save
        </button>
      </div>
      {hasSavedKey && (
        <button
          type="button"
          onClick={() => void setApiKey(settings.provider, "")}
          className="self-start text-[10px] text-foreground hover:text-foreground-primary cursor-pointer"
        >
          Remove stored key
        </button>
      )}
      {!settings.secureStorage && (
        <p className="text-[10px] text-foreground">
          This system has no encrypted credential store, so keys are kept in memory for this session only.
        </p>
      )}
      {provider?.apiKeyUrl && (
        <a
          href={provider.apiKeyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-foreground hover:text-foreground-primary inline-flex items-center gap-1"
        >
          Get a key <ExternalLink size={10} />
        </a>
      )}

      <label className="flex items-center gap-2 text-[11px] text-foreground-primary cursor-pointer mt-1">
        <input
          type="checkbox"
          checked={settings.shareContext}
          onChange={(event) => void update({ shareContext: event.target.checked })}
          className="accent-white"
        />
        Tell the model which window is focused
      </label>

      <label className="text-[10px] uppercase tracking-wide text-foreground mt-1">System prompt</label>
      <textarea
        value={settings.systemPrompt}
        onChange={(event) => void update({ systemPrompt: event.target.value })}
        rows={3}
        className="w-full p-2 rounded-2xl bg-background text-foreground-primary text-xs outline-none resize-none border border-stroke-separator"
      />
    </div>
  );
};
