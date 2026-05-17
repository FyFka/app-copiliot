import type { Message } from '../model/types'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={`message-bubble message-bubble--${message.role}`}>
      {message.content}
    </div>
  )
}
