import { useCallback } from "react";
import { copilotApi } from "@/shared";

export function useOverlayThrough(panelWidth: number) {
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const inPanel = event.clientX >= window.innerWidth - panelWidth;
      copilotApi.setClickThrough(!inPanel);
    },
    [panelWidth],
  );

  const handlePointerLeave = useCallback(() => {
    copilotApi.setClickThrough(true);
  }, []);

  return { handlePointerMove, handlePointerLeave };
}
