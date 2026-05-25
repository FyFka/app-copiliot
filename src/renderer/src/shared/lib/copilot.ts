import type { CopilotApi } from "../model/types";

function getApi(): CopilotApi | undefined {
  return window.copilot;
}

export const copilotApi = {
  setClickThrough(enabled: boolean): Promise<void> {
    return getApi()?.setClickThrough(enabled) ?? Promise.resolve();
  },
};
