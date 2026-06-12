import { useState, type ChangeEvent } from "react";
import { InputMessage } from "./input-message";
import { Select, Input } from "@/shared";
import { type Message, useSettingsStore, type SelectOption } from "@/shared";

const MODEL_OPTIONS: SelectOption[] = [
  { value: "gpt-4o", label: "GPT-4o (OpenAI)" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 (OpenAI)" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Google)" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (Google)" },
  { value: "deepseek-chat", label: "DeepSeek" },
];

export const Chat = () => {
  const { apiKey, setApiKey, model, setModel } = useSettingsStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
  };

  return (
    <aside className="h-full p-1 relative flex flex-col gap-2">
      <div className="bg-background rounded-2xl border border-stroke-separator p-2 flex flex-col gap-2">
        <div className="flex justify-between items-center px-2">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="text-[10px] text-foreground hover:text-white transition-colors"
          >
            {isSettingsOpen ? "✕ Close Settings" : "⚙️ AI Settings"}
          </button>
        </div>

        {isSettingsOpen && (
          <div className="flex flex-col gap-2 p-2 bg-secondary-background rounded-xl">
            <Select options={MODEL_OPTIONS} value={model} onChange={setModel} placeholder="Select Model" />
            <Input type="password" placeholder="API Key" value={apiKey} onChange={handleApiKeyChange} label="API Key" />
          </div>
        )}
      </div>

      <div className="flex-1 bg-background rounded-2xl border border-stroke-separator flex flex-col overflow-hidden p-1">
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-foreground text-center">
              <h2>How can I help you today?</h2>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : "text-left"}`}>
                <div
                  className={`inline-block p-2 rounded-xl max-w-[80%] ${
                    msg.role === "user"
                      ? "bg-primary-foreground text-background"
                      : "bg-secondary-background text-foreground-primary"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>
        <InputMessage messages={messages} setMessages={setMessages} />
      </div>
    </aside>
  );
};
