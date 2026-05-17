import type { ChatReply, CopilotApi } from '../model/types'

function getApi(): CopilotApi | undefined {
  return window.copilot
}

export const copilotApi = {
  setClickThrough(enabled: boolean): Promise<void> {
    return getApi()?.setClickThrough(enabled) ?? Promise.resolve()
  },

  focusTarget(): Promise<void> {
    return getApi()?.focusTarget() ?? Promise.resolve()
  },

  hide(): Promise<void> {
    return getApi()?.hide() ?? Promise.resolve()
  },

  sendMessage(text: string): Promise<ChatReply> {
    return (
      getApi()?.sendMessage(text) ??
      Promise.resolve({
        role: 'assistant',
        content: 'Electron API недоступен (режим браузера).',
      })
    )
  },

  onPanelWidth(callback: (width: number) => void): () => void {
    return getApi()?.onPanelWidth(callback) ?? (() => {})
  },
}
