import { SendHorizonalIcon, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { type Message, useSettingsStore } from "@/shared";
import { toast } from "sonner";

interface InputMessageProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export const InputMessage = ({ messages, setMessages }: InputMessageProps) => {
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { apiKey, model } = useSettingsStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!value.trim() || isLoading) return;
    if (!apiKey) {
      toast.error("Please enter API Key in settings");
      return;
    }

    const userMessage: Message = { role: "user", content: value };
    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setValue("");
    setIsLoading(true);

    try {
      const result = await window.copilot.ask({ messages: newMessages, model, apiKey });

      if (result.error) {
        toast.error(result.error);
      } else {
        setMessages([...newMessages, { role: "assistant", content: result.content }]);
      }
    } catch (err: unknown) {
      console.log(err);
      toast.error("Failed to connect to AI");
    } finally {
      setIsLoading(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="border border-stroke-separator rounded-2xl p-2 bg-background">
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Ask anything..."
          rows={1}
          className="w-full p-2 text-white bg-transparent outline-none resize-none text-sm max-h-32"
        />
        <button
          disabled={isLoading || !value.trim()}
          className="p-2.5 text-background bg-white rounded-full disabled:opacity-50 transition-opacity"
          type="submit"
        >
          {isLoading ? <Loader2 className="animate-spin" size={16} /> : <SendHorizonalIcon size={16} />}
        </button>
      </form>
    </div>
  );
};
