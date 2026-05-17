export interface ChatReply {
  role: 'assistant'
  content: string
}

export interface CopilotApi {
  setClickThrough(enabled: boolean): Promise<void>
  focusTarget(): Promise<void>
  hide(): Promise<void>
  sendMessage(text: string): Promise<ChatReply>
  onPanelWidth(callback: (width: number) => void): () => void
}
