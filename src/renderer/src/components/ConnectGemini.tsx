import { useState, type ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { api } from '@renderer/platform/api'
import { formatModelName } from '@renderer/lib/format'
import { BrandMark, CheckIcon, ExternalIcon, KeyIcon, WarningIcon } from './Icons'

const KEY_URL = 'https://aistudio.google.com/apikey'

interface Outcome {
  tone: 'ok' | 'error'
  title: string
  text: string
  detail?: string
}

/**
 * First-run screen shown while no API key is configured.
 *
 * GPTN never ships a key: this walks the user through creating their own, stores
 * it in the Keychain and proves it works with a real request before the chat is
 * unlocked. If the key does not work it is not kept, so the screen can simply be
 * retried.
 */
export function ConnectGemini(): ReactElement {
  const saveApiKey = useChatStore((state) => state.saveApiKey)
  const runKeyTest = useChatStore((state) => state.runKeyTest)
  const openSettings = useChatStore((state) => state.openSettings)
  const pushToast = useChatStore((state) => state.pushToast)
  const encryptionAvailable = useChatStore((state) => state.secrets?.encryptionAvailable ?? false)

  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const connect = async (): Promise<void> => {
    const value = key.trim()
    if (!value || busy) return

    setBusy(true)
    setOutcome(null)

    // The pasted key is verified before it is written anywhere: a key that
    // cannot answer is never stored, so the failure stays on this screen.
    const result = await runKeyTest(undefined, value)

    if (!result.ok) {
      setBusy(false)
      setOutcome({
        tone: 'error',
        title: result.error?.title ?? 'The connection test failed',
        text: `${result.error?.message ?? 'Gemini did not answer.'} Nothing was saved.`,
        detail: result.error?.detail
      })
      return
    }

    const status = await saveApiKey(value)
    setBusy(false)

    if (!status) {
      // saveApiKey already surfaced the reason through a toast.
      setOutcome({
        tone: 'error',
        title: 'The key works, but it could not be stored',
        text: 'Try again, or paste it in Settings → AI.'
      })
      return
    }

    // The chat unlocks, so this screen goes away: the confirmation is the toast.
    setKey('')
    const model = result.model ? formatModelName(result.model) : 'Gemini'
    pushToast(`Connected — ${model} replied in ${result.latencyMs ?? 0} ms`, 'success')
  }

  return (
    <div className="empty-state connect-state">
      <div className="empty-mark">
        <BrandMark size={26} />
      </div>
      <h1 className="empty-title">Connect Gemini</h1>
      <p className="empty-subtitle">
        GPTN has no servers and no shared key: it talks to Google Gemini with your own API key, which stays
        encrypted on this Mac. It takes about a minute.
      </p>

      <div className="connect-card">
        <div className="connect-step">
          <span className="connect-step-index">1</span>
          <div className="connect-step-body">
            <div className="connect-step-title">Create a free API key</div>
            <div className="connect-step-text">Google AI Studio hands one out in a couple of clicks.</div>
            <button
              type="button"
              className="button"
              onClick={() => void api.app.openExternal(KEY_URL)}
              data-testid="connect-create-key"
            >
              <KeyIcon size={13} />
              Open Google AI Studio
              <ExternalIcon size={12} />
            </button>
          </div>
        </div>

        <div className="connect-step">
          <span className="connect-step-index">2</span>
          <div className="connect-step-body">
            <div className="connect-step-title">Paste it here</div>
            <div className="connect-step-text">
              GPTN stores it in the macOS Keychain and makes one real request to check that it works.
            </div>
            <div className="connect-input-row">
              <input
                className="text-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="AIza…"
                value={key}
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void connect()
                }}
                aria-label="Gemini API key"
              />
              <button
                type="button"
                className="button primary"
                onClick={() => void connect()}
                disabled={busy || !key.trim()}
              >
                {busy ? 'Testing…' : 'Save & test'}
              </button>
            </div>
            {!encryptionAvailable && (
              <div className="connect-note warn">
                <WarningIcon size={12} />
                Encryption is unavailable on this Mac, so the key would only be kept for this session.
              </div>
            )}
          </div>
        </div>

        {outcome && (
          <div className={`connect-status ${outcome.tone}`} role="status" data-testid="connect-status">
            {outcome.tone === 'ok' ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
            <div>
              <div className="connect-status-title">{outcome.title}</div>
              <div className="connect-status-text">{outcome.text}</div>
              {outcome.detail && (
                <details className="connect-details">
                  <summary>Technical details</summary>
                  <code>{outcome.detail}</code>
                </details>
              )}
            </div>
          </div>
        )}
      </div>

      <button type="button" className="connect-link" onClick={() => openSettings('ai')}>
        I already have a key — open Settings → AI
      </button>
    </div>
  )
}
