import type { ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { CheckIcon, InfoIcon, WarningIcon } from './Icons'

/** Transient, non-blocking feedback (export finished, key saved, request failed…). */
export function Toasts(): ReactElement | null {
  const toasts = useChatStore((state) => state.toasts)
  const dismiss = useChatStore((state) => state.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast ${toast.tone}`}
          onClick={() => dismiss(toast.id)}
          title="Dismiss"
        >
          {toast.tone === 'error' ? (
            <WarningIcon size={14} />
          ) : toast.tone === 'success' ? (
            <CheckIcon size={14} />
          ) : (
            <InfoIcon size={14} />
          )}
          <span>{toast.message}</span>
        </button>
      ))}
    </div>
  )
}
