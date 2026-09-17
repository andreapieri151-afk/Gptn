import { memo, type ReactElement } from 'react'
import type { ChatMessage } from '@shared/types'
import { Markdown } from './Markdown'
import { CopyButton } from './CopyButton'
import { ErrorCard } from './ErrorCard'
import { RefreshIcon } from './Icons'

interface MessageItemProps {
  message: ChatMessage
  isStreaming: boolean
  showUsage: boolean
  onRetry?: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function usageLabel(message: ChatMessage): string | null {
  const usage = message.usage
  if (!usage) return null
  const parts: string[] = []
  if (usage.promptTokens) parts.push(`${usage.promptTokens} in`)
  if (usage.outputTokens) parts.push(`${usage.outputTokens} out`)
  if (!parts.length && usage.totalTokens) parts.push(`${usage.totalTokens} tokens`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * One turn of the conversation. User turns are compact, right aligned bubbles;
 * assistant turns use the full column width for comfortable long-form reading.
 * Nothing is rendered until the model actually produces content, so an empty
 * placeholder never flashes on screen.
 */
export const MessageItem = memo(function MessageItem({
  message,
  isStreaming,
  showUsage,
  onRetry
}: MessageItemProps): ReactElement | null {
  const failed = message.state === 'error'
  const interrupted = message.state === 'interrupted'
  const hasContent = message.content.length > 0

  if (message.role === 'user') {
    return (
      <div className="message user">
        <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div className="bubble">{message.content}</div>
          <div className="message-actions">
            <span className="message-meta">{formatTime(message.createdAt)}</span>
            <CopyButton text={message.content} label="Copy message" />
          </div>
        </div>
      </div>
    )
  }

  const usage = usageLabel(message)

  return (
    <div className={`message assistant${isStreaming ? ' actions-locked' : ''}`}>
      <div className="content">
        {message.thought && (
          <details className="thinking" open={isStreaming}>
            <summary>{isStreaming ? 'Thinking…' : 'Reasoning summary'}</summary>
            <div className="thinking-body">{message.thought}</div>
          </details>
        )}

        {failed && message.error ? (
          <ErrorCard error={message.error} {...(onRetry ? { onRetry: () => onRetry() } : {})} />
        ) : null}

        {hasContent && (
          <>
            <Markdown content={message.content} />
            {isStreaming && <span className="streaming-caret" aria-hidden="true" />}
          </>
        )}

        {failed && hasContent && (
          <div style={{ marginTop: 10 }}>
            <ErrorCard
              error={message.error ?? { code: 'UNKNOWN', title: 'Something went wrong', message: '', retryable: true }}
              {...(onRetry ? { onRetry: () => onRetry() } : {})}
              compact
            />
          </div>
        )}

        {!failed && (
          <div className="message-actions">
            {hasContent && <CopyButton text={message.content} label="Copy answer" />}
            {onRetry && !isStreaming && (
              <button type="button" className="message-action" onClick={() => onRetry()}>
                <RefreshIcon size={13} />
                Regenerate
              </button>
            )}
            {interrupted && <span className="message-meta">Stopped</span>}
            {showUsage && usage && <span className="message-meta">{usage}</span>}
          </div>
        )}
      </div>
    </div>
  )
})
