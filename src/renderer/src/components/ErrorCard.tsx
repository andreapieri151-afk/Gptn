import type { ReactElement } from 'react'
import type { MessageError } from '@shared/types'
import { WarningIcon } from './Icons'
import { useChatStore } from '@renderer/state/store'

/** Error codes that are usually fixed from the Settings → AI screen. */
const SETTINGS_HINTS = new Set([
  'NO_API_KEY',
  'INVALID_API_KEY',
  'PERMISSION_DENIED',
  'MODEL_NOT_FOUND',
  'QUOTA_EXCEEDED',
  'INVALID_REQUEST',
  'MAX_TOKENS'
])

interface ErrorCardProps {
  error: MessageError
  onRetry?: () => void
  compact?: boolean
}

/**
 * Every failure is presented in plain language, with an optional disclosure for
 * the raw API detail and a direct route to the relevant setting.
 */
export function ErrorCard({ error, onRetry, compact = false }: ErrorCardProps): ReactElement {
  const openSettings = useChatStore((state) => state.openSettings)
  const showSettings = SETTINGS_HINTS.has(error.code)

  return (
    <div className="error-card" role="alert" style={compact ? { padding: '10px 12px' } : undefined}>
      <WarningIcon size={16} style={{ color: 'var(--danger)', flex: '0 0 auto', marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="error-title">{error.title}</div>
        <div className="error-message">{error.message}</div>
        {(onRetry || showSettings) && (
          <div className="error-actions">
            {showSettings && (
              <button type="button" className="button" onClick={() => openSettings('ai')}>
                Open Settings
              </button>
            )}
            {onRetry && (
              <button type="button" className="button" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
        {error.detail && (
          <details className="error-details">
            <summary>Technical details</summary>
            {error.detail}
          </details>
        )}
      </div>
    </div>
  )
}
