import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { MessageItem } from './MessageItem'
import { ErrorCard } from './ErrorCard'
import { ChevronDownIcon } from './Icons'

interface MessageListProps {
  /** Called when a suggestion from the empty state is chosen. */
  emptySlot: ReactElement
  onRetry: () => void
}

/**
 * Scroll container for the transcript. Auto-follows the stream while the user
 * stays at the bottom, and stops following as soon as they scroll up to read.
 */
export function MessageList({ emptySlot, onRetry }: MessageListProps): ReactElement {
  const messages = useChatStore((state) => state.messages)
  const streamingMessageId = useChatStore((state) => state.streamingMessageId)
  const isGenerating = useChatStore((state) => state.requestId !== null)
  const showUsage = useChatStore((state) => state.settings?.showTokenUsage ?? false)
  const lastError = useChatStore((state) => state.lastError)
  const clearError = useChatStore((state) => state.clearError)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const lastMessage = messages[messages.length - 1]
  const streamingText = streamingMessageId ? lastMessage?.content ?? '' : ''

  const scrollToBottom = (smooth = false): void => {
    const element = scrollRef.current
    if (!element) return
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    } else {
      element.scrollTop = element.scrollHeight
    }
  }

  // Follow new content only when the user has not scrolled away.
  useLayoutEffect(() => {
    if (!pinnedRef.current) return
    scrollToBottom()
  }, [messages, streamingText])

  useEffect(() => {
    if (messages.length === 0) pinnedRef.current = true
  }, [messages.length])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    pinnedRef.current = distance < 80
    setShowJump(distance > 240)
  }

  // An error without an assistant bubble (e.g. missing API key) needs its own card.
  const showStandaloneError =
    !!lastError && !messages.some((message) => message.state === 'error')

  return (
    <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
      {messages.length === 0 ? (
        emptySlot
      ) : (
        <div className="chat-column">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              isStreaming={message.id === streamingMessageId}
              showUsage={showUsage}
              {...(message.role === 'assistant' && message.id === lastMessage?.id && !isGenerating
                ? { onRetry }
                : {})}
            />
          ))}

          {isGenerating && !streamingText && (
            <div className="generating-row" aria-live="polite">
              <span className="generating-dots">
                <span />
                <span />
                <span />
              </span>
              Generating…
            </div>
          )}

          {showStandaloneError && lastError && (
            <div style={{ marginTop: 18 }}>
              <ErrorCard
                error={lastError}
                {...(lastError.code === 'MAX_TOKENS' ? {} : { onRetry: onRetry })}
              />
              <button
                type="button"
                className="message-action"
                style={{ marginTop: 6 }}
                onClick={clearError}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {showJump && (
        <button
          type="button"
          className="button"
          style={{ position: 'fixed', right: 26, bottom: 108, boxShadow: 'var(--shadow-md)', zIndex: 20 }}
          onClick={() => {
            pinnedRef.current = true
            scrollToBottom(true)
          }}
        >
          <ChevronDownIcon size={14} />
          Latest
        </button>
      )}
    </div>
  )
}
