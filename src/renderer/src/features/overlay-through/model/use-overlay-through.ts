import { useEffect } from "react";
import { copilotApi } from "@/shared";

/**
 * Anything the user must be able to click. Floating-ui portals and toasts live
 * outside the panel subtree, so they are listed explicitly.
 */
const INTERACTIVE_SELECTOR = "[data-interactive], #modals, #tooltips, [data-sonner-toaster]";

/**
 * The overlay covers the whole target window, so it has to stay click-through
 * everywhere except over the panel — otherwise the app underneath becomes
 * unusable. The main process keeps forwarding mousemove while clicks pass
 * through, which is what lets this hook notice the pointer arriving.
 */
export const useOverlayThrough = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      void copilotApi.setClickThrough(true);
      return;
    }

    // Mirrors the main process' state so we only cross the IPC boundary on an
    // actual change rather than on every mouse move.
    let isClickThrough = true;

    const apply = (next: boolean) => {
      if (next === isClickThrough) return;
      isClickThrough = next;
      void copilotApi.setClickThrough(next);
    };

    const handleMove = (event: MouseEvent) => {
      // Never hand clicks back mid-drag: releasing the panel while resizing it or
      // selecting text would drop the gesture on the app underneath.
      if (event.buttons !== 0) return;

      const element = document.elementFromPoint(event.clientX, event.clientY);
      apply(!element?.closest(INTERACTIVE_SELECTOR));
    };

    const handleLeave = () => apply(true);

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseleave", handleLeave);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
      void copilotApi.setClickThrough(true);
    };
  }, [enabled]);
};
