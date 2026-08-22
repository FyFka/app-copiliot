import { useEffect, useRef } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { Message } from "@/shared";

interface MessageListProps {
  messages: Message[];
  streamed: string | null;
}

const Bubble = ({ message }: { message: Message }) => {
  const isUser = message.role === "user";

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(message.content)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Could not copy"));
  };

  return (
    <div className={`group text-sm flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`inline-block p-2 rounded-xl max-w-[85%] whitespace-pre-wrap break-words ${
          isUser ? "bg-primary-foreground text-background" : "bg-secondary-background text-foreground-primary"
        }`}
      >
        {message.content}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy message"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-foreground-primary mt-0.5 cursor-pointer"
      >
        <Copy size={11} />
      </button>
    </div>
  );
};

export const MessageList = ({ messages, streamed }: MessageListProps) => {
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, including while a reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamed]);

  if (messages.length === 0 && streamed === null) {
    return (
      <div className="h-full flex items-center justify-center text-foreground text-center px-4">
        <h2 className="text-sm">How can I help you today?</h2>
      </div>
    );
  }

  return (
    <>
      {messages.map((message, index) => (
        <Bubble key={index} message={message} />
      ))}

      {streamed !== null && (
        <div className="text-sm text-left">
          <div className="inline-block p-2 rounded-xl max-w-[85%] whitespace-pre-wrap break-words bg-secondary-background text-foreground-primary">
            {streamed}
            <span className="inline-block w-1.5 h-3.5 -mb-0.5 ml-0.5 bg-foreground-primary animate-pulse" />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </>
  );
};
