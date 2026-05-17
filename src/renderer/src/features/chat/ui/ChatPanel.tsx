import { type FormEvent, type KeyboardEvent } from 'react'
import { MessageBubble, TypingIndicator } from '@/entities/message'
import { Button } from '@/shared/ui/button/Button'
import { useChat } from '../model/useChat'
import './ChatPanel.css'

export function ChatPanel() {
  const { messages, input, isSending, listRef, inputRef, setInput, sendMessage } =
    useChat()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void sendMessage()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div className="chat-panel">
      <div ref={listRef} className="chat-panel__messages" role="log" aria-live="polite">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isSending && <TypingIndicator />}
      </div>

      <form className="chat-panel__composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Спросите что угодно…"
          rows={3}
          disabled={isSending}
        />
        <Button type="submit" disabled={isSending || !input.trim()}>
          Отправить
        </Button>
      </form>
    </div>
  )
}
