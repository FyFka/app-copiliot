import { useEffect, useState, type ReactNode } from "react";
import { copilotApi } from "@/shared";

export const VisibleProvider = ({ children }: { children: ReactNode }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const cleanup = window.copilot.onVisibilityChange(() => {
      console.log("renderer received visibility-change"); // verify this fires
      setIsVisible((prev) => !prev);
    });

    copilotApi.setClickThrough(true);

    return cleanup;
  }, []);

  return <div className={isVisible ? "block" : "hidden"}>{children}</div>;
};
