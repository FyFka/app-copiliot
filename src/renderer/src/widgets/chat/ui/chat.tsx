import { InputMessage } from "./input-message";

export const Chat = () => {
  return (
    <aside className="h-full p-1 relative">
      <div className="h-full bg-background rounded-2xl border border-stroke-separator flex flex-col gap-2 p-1">
        <div className="flex-1 min-h-0 flex items-center justify-center text-foreground text-center">
          <h2>What are you working on?</h2>
        </div>
        <InputMessage />
      </div>
      <button className="h-3/12 w-0.5 bg-amber-50 absolute top-1/2 -translate-y-1/2 right-1 rounded-full"></button>
    </aside>
  );
};
