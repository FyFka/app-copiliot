import { useEffect, useState } from "react";
import { PlusIcon, SettingsIcon, XIcon } from "lucide-react";
import { InputMessage } from "./input-message";
import { MessageList } from "./message-list";
import { ChatSettings } from "./chat-settings";
import { useChat } from "../model/use-chat";
import { copilotApi, useActiveWindow, useSettingsStore } from "@/shared";

export const Chat = () => {
  const { settings, isLoaded, load } = useSettingsStore();
  const { messages, streamed, isLoading, send, stop, reset } = useChat();
  const context = useActiveWindow();
  const [settingsOverride, setSettingsOverride] = useState<boolean | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing is configured yet on a fresh install — default to showing settings
  // so the first run does not look like an empty, broken panel. Once the user
  // touches the toggle, their choice wins.
  const needsSetup = isLoaded && !settings.savedKeys[settings.provider];
  const isSettingsOpen = settingsOverride ?? needsSetup;

  const contextLabel = context.app || context.title;

  return (
    <aside data-interactive className="h-full p-1 relative flex flex-col gap-2 pointer-events-auto">
      <div className="bg-background rounded-2xl border border-stroke-separator p-2 flex flex-col gap-2">
        <div className="flex justify-between items-center gap-2">
          <div className="min-w-0 flex flex-col">
            <span className="text-xs font-semibold text-foreground-primary">Copilot</span>
            {settings.shareContext && contextLabel && (
              <span className="text-[10px] text-foreground truncate" title={context.title}>
                {contextLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={reset}
              aria-label="New chat"
              className="p-1.5 rounded-full text-foreground hover:text-foreground-primary hover:bg-secondary-background cursor-pointer"
            >
              <PlusIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOverride(!isSettingsOpen)}
              aria-label={isSettingsOpen ? "Close settings" : "Open settings"}
              aria-expanded={isSettingsOpen}
              className={`p-1.5 rounded-full hover:bg-secondary-background cursor-pointer ${
                isSettingsOpen ? "text-foreground-primary" : "text-foreground hover:text-foreground-primary"
              }`}
            >
              <SettingsIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => void copilotApi.hide()}
              aria-label="Hide overlay"
              className="p-1.5 rounded-full text-foreground hover:text-foreground-primary hover:bg-secondary-background cursor-pointer"
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>

        {isSettingsOpen && <ChatSettings />}
      </div>

      <div className="flex-1 min-h-0 bg-background rounded-2xl border border-stroke-separator flex flex-col overflow-hidden p-1">
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
          <MessageList messages={messages} streamed={streamed} />
        </div>
        <InputMessage isLoading={isLoading} onSend={(text) => void send(text)} onStop={stop} />
      </div>
    </aside>
  );
};
