import type { CopilotApi } from "../model/types";

const getApi = (): CopilotApi | undefined => {
  return window.copilot;
};

export const copilotApi = {
  setClickThrough(enabled: boolean): Promise<void> {
    return getApi()?.setClickThrough(enabled) ?? Promise.resolve();
  },
};
