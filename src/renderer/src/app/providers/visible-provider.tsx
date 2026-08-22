import { useEffect, useState, type ReactNode } from "react";
import { copilotApi, isCopilotAvailable } from "@/shared";
import { useOverlayThrough } from "@/features/overlay-through";

export const VisibleProvider = ({ children }: { children: ReactNode }) => {
  // The main process owns visibility so the tray, the global shortcut and the
  // panel's own close button can never disagree about it. Opened straight in a
  // browser there is no main process to ask, so show the panel instead of
  // rendering a blank page.
  const [isVisible, setIsVisible] = useState(() => !isCopilotAvailable());

  useEffect(() => copilotApi.onVisibilityChange(setIsVisible), []);

  useOverlayThrough(isVisible);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void copilotApi.hide();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible]);

  // Kept mounted while hidden so an in-flight reply and the conversation
  // survive toggling the overlay away and back.
  return <div className={isVisible ? "contents" : "hidden"}>{children}</div>;
};
