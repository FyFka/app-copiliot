import { useEffect, useState } from "react";
import { copilotApi } from "./copilot";
import type { ActiveWindowContext } from "../model/types";

/** Title and owner of the window the overlay is currently sitting on. */
export const useActiveWindow = (): ActiveWindowContext => {
  const [context, setContext] = useState<ActiveWindowContext>({ title: "", app: "" });

  useEffect(() => {
    let isMounted = true;
    void copilotApi.getContext().then((initial) => {
      if (isMounted) setContext(initial);
    });

    const unsubscribe = copilotApi.onContextChange(setContext);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return context;
};
