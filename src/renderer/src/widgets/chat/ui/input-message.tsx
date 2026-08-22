import { SendHorizonalIcon, Square } from "lucide-react";
import { useRef, useState } from "react";

interface InputMessageProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_HEIGHT_PX = 128;

export const InputMessage = ({ isLoading, onSend, onStop }: InputMessageProps) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  };

  const submit = () => {
    if (!value.trim() || isLoading) return;
    onSend(value);
    setValue("");
    // Height is set imperatively, so it has to be reset the same way.
    requestAnimationFrame(resize);
  };

  return (
    <div className="border border-stroke-separator rounded-2xl p-2 bg-background">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask anything..."
          rows={1}
          className="w-full p-2 text-foreground-primary bg-transparent outline-none resize-none text-sm"
        />

        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="p-2.5 text-background bg-white rounded-full transition-opacity cursor-pointer"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send message"
            className="p-2.5 text-background bg-white rounded-full disabled:opacity-50 transition-opacity cursor-pointer"
          >
            <SendHorizonalIcon size={16} />
          </button>
        )}
      </form>
    </div>
  );
};
