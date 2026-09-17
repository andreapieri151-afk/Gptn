import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { ArrowUpIcon, StopIcon } from './Icons'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
  /** Disables sending without hiding the composer (no API key yet). */
  blocked?: boolean
  blockedHint?: string
}

const MAX_HEIGHT = 260

/**
 * Message composer: multi-line field, Enter to send, Shift+Enter for a new line,
 * Send / Stop in the same spot, and a soft focus ring instead of heavy borders.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  blocked = false,
  blockedHint
}: ComposerProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Grow with the content, up to a limit, then scroll inside the field.
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSend = value.trim().length > 0 && !isGenerating && !blocked

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      // Let the palette shortcut bubble to the document handler.
      return
    }
  }

  const hint = blocked && blockedHint ? blockedHint : 'Enter to send · Shift + Enter for a new line'

  return (
    <div className="composer-wrap">
      <div className="composer-column">
        <div className={`composer${isGenerating ? ' generating' : ''}`}>
          <textarea
            id="composer-input"
            ref={textareaRef}
            value={value}
            rows={1}
            spellCheck
            placeholder={blocked ? 'Add your Gemini API key in Settings to start…' : 'Send a message to GPTN'}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
          />
          <div className="composer-bar">
            <span className="composer-hint">{hint}</span>
            <div className="composer-spacer" />
            {isGenerating ? (
              <button type="button" className="stop-button" onClick={onStop} aria-label="Stop generating">
                <StopIcon size={13} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="Send message"
                title="Send (Enter)"
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-footer">
          {isGenerating ? 'GPTN is generating an answer · press Esc to stop' : 'GPTN can make mistakes. Check important information.'}
        </div>
      </div>
    </div>
  )
}
