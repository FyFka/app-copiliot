import { useEffect, useRef, useState } from 'react'
import type { Message } from '@/entities/message'
import { copilotApi } from '@/shared/api/copilot'
import { WELCOME_MESSAGE } from '@/shared/config/constants'
import { createId } from '@/shared/lib/createId'

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isSending])

  async function sendMessage() {
    const text = input.trim()
    if (!text || isSending) return

    setMessages((prev) => [...prev, { id: createId(), role: 'user', content: text }])
    setInput('')
    setIsSending(true)

    try {
      const reply = await copilotApi.sendMessage(text)
      setMessages((prev) => [
        ...prev,
        { id: createId(), role: 'assistant', content: reply.content },
      ])
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }

  return {
    messages,
    input,
    isSending,
    listRef,
    inputRef,
    setInput,
    sendMessage,
  }
}
