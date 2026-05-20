import { SendHorizonalIcon } from "lucide-react";
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react";

export const InputMessage = () => {
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [isMultiLine, setIsMultiLine] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isOverLimit = value.length > 50000;

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>) => {
    try {
      e.preventDefault();

      if (!value.trim() || isOverLimit) return;

      setLoading(true);
      // FETCH
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        setIsMultiLine(false);
      }
    } catch (err: unknown) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;

    el.style.height = "auto";
    const currentHeight = el.scrollHeight;

    el.style.height = `${Math.min(currentHeight, 250)}px`;

    setIsMultiLine(currentHeight > 55);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const btnProps = isOverLimit || !value.trim() ? { disabled: true, title: "Invalid message" } : {};

  return (
    <div
      className={`border border-stroke-separator rounded-2xl transition-colors ${isOverLimit ? "border-red-500" : ""}`}
    >
      <form onSubmit={handleSubmit} className={`flex ${isMultiLine ? "flex-col" : "flex-row items-end"} p-2 gap-2`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything"
          rows={1}
          name="message"
          className="w-full p-2 text-white bg-transparent outline-none resize-none block text-sm"
        />

        <div className={`flex ${isMultiLine ? "w-full justify-end" : ""}`}>
          <button
            className="p-2.5 text-foreground border border-stroke-separator rounded-full cursor-pointer z-10 bg-white opacity-90 disabled:opacity-50"
            type="submit"
            {...btnProps}
          >
            <SendHorizonalIcon size={16} />
          </button>
        </div>
      </form>
    </div>
  );
};
