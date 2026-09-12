import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { ModelInfo, Settings, ThemeMode } from '@shared/types'
import { useChatStore, type SettingsSection } from '@renderer/state/store'
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  ExternalIcon,
  FolderIcon,
  InfoIcon,
  KeyIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon
} from './Icons'
import { ConfirmDialog } from './ConfirmDialog'
import { formatBytes, formatModelName } from '@renderer/lib/format'
import { api } from '@renderer/platform/api'

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: ReactElement }> = [
  { id: 'general', label: 'General', icon: <SettingsIcon size={15} /> },
  { id: 'ai', label: 'AI / Gemini', icon: <SparkIcon size={15} /> },
  { id: 'data', label: 'Data', icon: <FolderIcon size={15} /> },
  { id: 'about', label: 'About', icon: <InfoIcon size={15} /> }
]

const SECTION_TITLES: Record<SettingsSection, string> = {
  general: 'General',
  ai: 'AI / Gemini',
  data: 'Data',
  about: 'About GPTN'
}

function Row({ name, hint, children }: { name: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <div className="name">{name}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function GeneralSection(): ReactElement {
  const settings = useChatStore((state) => state.settings)
  const updateSettings = useChatStore((state) => state.updateSettings)
  if (!settings) return <></>

  return (
    <div className="settings-group">
      <div className="settings-group-title">Appearance</div>
      <Row name="Theme" hint="System follows the macOS appearance automatically.">
        <Segmented<ThemeMode>
          value={settings.theme}
          onChange={(theme) => void updateSettings({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
        />
      </Row>
      <Row name="Token usage" hint="Show prompt/output token counts under each answer.">
        <Switch
          label="Show token usage"
          checked={settings.showTokenUsage}
          onChange={(showTokenUsage) => void updateSettings({ showTokenUsage })}
        />
      </Row>

      <div className="settings-group-title" style={{ marginTop: 22 }}>
        Behaviour
      </div>
      <Row name="On launch" hint="What GPTN should open when it starts.">
        <select
          className="select-input"
          value={settings.startBehavior}
          onChange={(event) =>
            void updateSettings({ startBehavior: event.target.value as Settings['startBehavior'] })
          }
          aria-label="Startup behaviour"
        >
          <option value="restore-last">Reopen the last conversation</option>
          <option value="new-chat">Start a new chat</option>
        </select>
      </Row>
      <Row name="Streaming" hint="Show the answer while Gemini is still writing it.">
        <Switch
          label="Streaming"
          checked={settings.streaming}
          onChange={(streaming) => void updateSettings({ streaming })}
        />
      </Row>
      <Row name="Sidebar" hint="Hide the sidebar to get a distraction-free window.">
        <button type="button" className="button" onClick={() => useChatStore.getState().toggleSidebar()}>
          {settings.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        </button>
      </Row>
    </div>
  )
}

function AiSection(): ReactElement {
  const settings = useChatStore((state) => state.settings)
  const secrets = useChatStore((state) => state.secrets)
  const models = useChatStore((state) => state.models)
  const modelsLoading = useChatStore((state) => state.modelsLoading)
  const saveApiKey = useChatStore((state) => state.saveApiKey)
  const clearApiKey = useChatStore((state) => state.clearApiKey)
  const runKeyTest = useChatStore((state) => state.runKeyTest)
  const refreshModels = useChatStore((state) => state.refreshModels)
  const updateSettings = useChatStore((state) => state.updateSettings)
  const pushToast = useChatStore((state) => state.pushToast)

  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [testedModel, setTestedModel] = useState<string | null>(null)
  const [topPDraft, setTopPDraft] = useState(settings?.topP?.toString() ?? '')
  const [maxTokensDraft, setMaxTokensDraft] = useState(settings?.maxOutputTokens?.toString() ?? '')
  const [customId, setCustomId] = useState('')

  useEffect(() => {
    setTopPDraft(settings?.topP?.toString() ?? '')
    setMaxTokensDraft(settings?.maxOutputTokens?.toString() ?? '')
  }, [settings?.topP, settings?.maxOutputTokens])

  if (!settings) return <></>

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (!value) return
    const status = await saveApiKey(value)
    if (status?.hasApiKey) {
      setKeyDraft('')
      pushToast('API key saved', 'success')
      void test(value)
    }
  }

  const test = async (model?: string): Promise<void> => {
    setTesting(true)
    setTestedModel(null)
    const result = await runKeyTest(model ?? settings.model)
    setTesting(false)
    if (result.ok) {
      setTestedModel(result.model ?? settings.model)
      pushToast(`Connected to ${formatModelName(result.model ?? settings.model)} · ${result.latencyMs} ms`, 'success')
      void refreshModels(true)
    } else if (result.error) {
      pushToast(`${result.error.title}: ${result.error.message}`, 'error')
    }
  }

  const persistTopP = (): void => {
    const parsed = Number.parseFloat(topPDraft)
    void updateSettings({ topP: Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : null })
  }

  const persistMaxTokens = (): void => {
    const parsed = Number.parseInt(maxTokensDraft, 10)
    void updateSettings({ maxOutputTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : null })
  }

  const storageLabel = (): { text: string; tone: string } => {
    if (!secrets?.encryptionAvailable) {
      return {
        text: 'Encryption unavailable — the key is kept in memory for this session only.',
        tone: 'warn'
      }
    }
    return { text: 'Encrypted and stored in the macOS Keychain.', tone: 'ok' }
  }

  const storage = storageLabel()

  return (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Gemini API key</div>
        <Row
          name="API key"
          hint="Create a key in Google AI Studio. It is stored encrypted through the macOS Keychain and never leaves your Mac except in requests to Google."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}>
            <div className="model-input-row">
              <input
                className="text-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={secrets?.hasApiKey ? secrets.maskedKey ?? 'Stored key' : 'AIza…'}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveKey()
                }}
                aria-label="Gemini API key"
              />
              <button type="button" className="button primary" onClick={() => void saveKey()} disabled={!keyDraft.trim()}>
                Save
              </button>
            </div>
            <div className="model-input-row">
              <button type="button" className="button" onClick={() => void test()} disabled={testing || !secrets?.hasApiKey}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  void clearApiKey()
                  setTestedModel(null)
                  pushToast('API key removed', 'success')
                }}
                disabled={!secrets?.hasApiKey}
              >
                Remove
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void api.app.openExternal('https://aistudio.google.com/apikey')}
              >
                Get a key
                <ExternalIcon size={13} />
              </button>
            </div>
            <div className="about-block" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className={`status-dot ${secrets?.hasApiKey ? (testedModel ? 'ok' : 'warn') : 'bad'}`} />
              <span>
                {secrets?.hasApiKey
                  ? `Key ${secrets.maskedKey} · ${storage.text}`
                  : 'No API key configured yet.'}
              </span>
            </div>
          </div>
        </Row>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Model</div>
        <Row name="Default model" hint="Used for new messages. You can also switch it from the sidebar.">
          <div className="model-input-row" style={{ width: 320 }}>
            <select
              className="select-input"
              value={settings.model}
              onChange={(event) => {
                void updateSettings({ model: event.target.value })
                void refreshModels(true)
              }}
              aria-label="Default model"
            >
              {!models.some((model: ModelInfo) => model.id === settings.model) && (
                <option value={settings.model}>{formatModelName(settings.model)}</option>
              )}
              {models.map((model: ModelInfo) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button"
              onClick={() => void refreshModels(true)}
              disabled={modelsLoading}
              title="Reload the model list from Google"
            >
              <RefreshIcon size={13} />
            </button>
          </div>
        </Row>

        <Row name="Temperature" hint="0 is focused and deterministic, 2 is the most creative.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(event) => void updateSettings({ temperature: Number(event.target.value) })}
              aria-label="Temperature"
              style={{ width: 150, accentColor: 'var(--accent)' }}
            />
            <span style={{ width: 26, textAlign: 'right', color: 'var(--text-secondary)' }}>
              {settings.temperature.toFixed(1)}
            </span>
          </div>
        </Row>

        <Row name="Top P" hint="Leave empty to use the model default.">
          <input
            className="text-input"
            style={{ width: 120 }}
            inputMode="decimal"
            placeholder="default"
            value={topPDraft}
            onChange={(event) => setTopPDraft(event.target.value)}
            onBlur={persistTopP}
            aria-label="Top P"
          />
        </Row>

        <Row name="Max output tokens" hint="Caps the length of an answer. Empty uses the model default.">
          <input
            className="text-input"
            style={{ width: 120 }}
            inputMode="numeric"
            placeholder="default"
            value={maxTokensDraft}
            onChange={(event) => setMaxTokensDraft(event.target.value)}
            onBlur={persistMaxTokens}
            aria-label="Max output tokens"
          />
        </Row>

        <Row name="Safety filters" hint="“Default” keeps Gemini's standard thresholds.">
          <Segmented<'default' | 'off'>
            value={settings.safetyMode}
            onChange={(safetyMode) => void updateSettings({ safetyMode })}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'off', label: 'Permissive' }
            ]}
          />
        </Row>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Instructions</div>
        <Row name="System instruction" hint="Sent at the start of every conversation to shape the style of the answers.">
          <textarea
            className="text-area"
            style={{ width: 360 }}
            placeholder="Example: Answer in Italian, concise and to the point."
            value={settings.systemInstruction}
            onChange={(event) => void updateSettings({ systemInstruction: event.target.value })}
            aria-label="System instruction"
          />
        </Row>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Advanced</div>
        <Row
          name="Custom model IDs"
          hint="Add a model id that is not listed (for example a preview model enabled on your account)."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}>
            <div className="model-input-row">
              <input
                className="text-input"
                placeholder="gemini-3-pro-preview"
                value={customId}
                spellCheck={false}
                onChange={(event) => setCustomId(event.target.value)}
                aria-label="Custom model id"
              />
              <button
                type="button"
                className="button"
                disabled={!customId.trim()}
                onClick={() => {
                  const id = customId.trim()
                  if (!id) return
                  const next = [...settings.customModels.filter((model) => model.id !== id), { id, label: id }]
                  setCustomId('')
                  void updateSettings({ customModels: next }).then(() => refreshModels(true))
                }}
              >
                Add
              </button>
            </div>
            {settings.customModels.map((model) => (
              <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckIcon size={13} style={{ color: 'var(--success)' }} />
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>{model.id}</span>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remove ${model.id}`}
                  onClick={() =>
                    void updateSettings({
                      customModels: settings.customModels.filter((item) => item.id !== model.id)
                    }).then(() => refreshModels(true))
                  }
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        </Row>
        <Row
          name="API base URL"
          hint="Only change this if you route Gemini through a proxy or enterprise gateway."
        >
          <input
            className="text-input"
            style={{ width: 320 }}
            placeholder="https://generativelanguage.googleapis.com/v1beta"
            value={settings.baseUrl}
            spellCheck={false}
            onChange={(event) => void updateSettings({ baseUrl: event.target.value })}
            aria-label="API base URL"
          />
        </Row>
      </div>
    </>
  )
}

function DataSection(): ReactElement {
  const dataStats = useChatStore((state) => state.dataStats)
  const exportConversations = useChatStore((state) => state.exportConversations)
  const importConversations = useChatStore((state) => state.importConversations)
  const deleteAllConversations = useChatStore((state) => state.deleteAllConversations)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    void api.data.stats().then((stats) => useChatStore.setState({ dataStats: stats }))
  }, [])

  return (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Local database</div>
        <div className="about-block">
          <dl>
            <dt>Conversations</dt>
            <dd>{dataStats?.conversations ?? '—'}</dd>
            <dt>Messages</dt>
            <dd>{dataStats?.messages ?? '—'}</dd>
            <dt>Database size</dt>
            <dd>{dataStats ? formatBytes(dataStats.databaseBytes) : '—'}</dd>
            <dt>Location</dt>
            <dd>{dataStats?.databasePath ?? '—'}</dd>
          </dl>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="button" onClick={() => void api.data.revealFolder()}>
            <FolderIcon size={13} />
            Show in Finder
          </button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Export &amp; import</div>
        <Row name="Export history" hint="Markdown for reading and sharing, JSON for a full backup you can re-import.">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="button" onClick={() => void exportConversations('markdown')}>
              <DownloadIcon size={13} />
              Markdown
            </button>
            <button type="button" className="button" onClick={() => void exportConversations('json')}>
              <DownloadIcon size={13} />
              JSON
            </button>
          </div>
        </Row>
        <Row name="Import" hint="Restores conversations from a GPTN JSON export.">
          <button type="button" className="button" onClick={() => void importConversations()}>
            <UploadIcon size={13} />
            Choose file…
          </button>
        </Row>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Danger zone</div>
        <Row name="Delete all conversations" hint="This removes every chat stored on this Mac. It cannot be undone.">
          <button type="button" className="button danger" onClick={() => setConfirming(true)}>
            <TrashIcon size={13} />
            Delete everything
          </button>
        </Row>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete all conversations?"
          message="Every chat stored on this Mac will be removed. Export a backup first if you want to keep them."
          confirmLabel="Delete all"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void deleteAllConversations()
          }}
        />
      )}
    </>
  )
}

function AboutSection(): ReactElement {
  const appInfo = useChatStore((state) => state.appInfo)
  const secrets = useChatStore((state) => state.secrets)

  const openExternal = (url: string): void => {
    void api.app.openExternal(url)
  }

  return (
    <div className="settings-group">
      <div className="settings-group-title">GPTN</div>
      <div className="about-block">
        <p style={{ marginTop: 0 }}>
          GPTN is a native-feeling desktop client for Google Gemini. Conversations, settings and your API key
          stay on this Mac: data is written to a local database and the key is protected by the macOS Keychain.
        </p>
        <dl>
          <dt>Version</dt>
          <dd>{appInfo?.version ?? '—'}</dd>
          <dt>Build</dt>
          <dd>
            Electron {appInfo?.electron ?? '—'} · Chromium {appInfo?.chrome ?? '—'} · Node {appInfo?.node ?? '—'}
          </dd>
          <dt>System</dt>
          <dd>
            {appInfo?.platform ?? '—'} {appInfo?.arch ?? ''}
          </dd>
          <dt>Data folder</dt>
          <dd>{appInfo?.userDataPath ?? '—'}</dd>
          <dt>Key storage</dt>
          <dd>{secrets?.encryptionAvailable ? 'macOS Keychain (encrypted)' : 'In memory only'}</dd>
        </dl>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" className="button" onClick={() => openExternal('https://aistudio.google.com/apikey')}>
          <KeyIcon size={13} />
          Gemini API keys
          <ExternalIcon size={12} />
        </button>
        <button type="button" className="button" onClick={() => openExternal('https://ai.google.dev/gemini-api/docs')}>
          Gemini docs
          <ExternalIcon size={12} />
        </button>
        <button type="button" className="button" onClick={() => void api.data.revealFolder()}>
          <FolderIcon size={13} />
          Open data folder
        </button>
      </div>
      <div className="about-block" style={{ marginTop: 18, color: 'var(--text-tertiary)' }}>
        © {new Date().getFullYear()} GPTN · Built with Electron, React and the Google Gemini API.
      </div>
    </div>
  )
}

/** Settings window: a native-style sheet with four sections. */
export function SettingsModal(): ReactElement | null {
  const open = useChatStore((state) => state.settingsOpen)
  const section = useChatStore((state) => state.settingsSection)
  const close = useChatStore((state) => state.closeSettings)

  if (!open) return null

  return (
    <div className="scrim settings-scrim" onMouseDown={close}>
      <div
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="GPTN settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${item.id === section ? ' active' : ''}`}
              onClick={() => useChatStore.setState({ settingsSection: item.id })}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <header className="settings-header">
            <h2>{SECTION_TITLES[section]}</h2>
            <button
              type="button"
              className="icon-button"
              style={{ marginLeft: 'auto' }}
              onClick={close}
              aria-label="Close settings"
            >
              <CloseIcon size={16} />
            </button>
          </header>
          <div className="settings-body">
            {section === 'general' && <GeneralSection />}
            {section === 'ai' && <AiSection />}
            {section === 'data' && <DataSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  )
}
