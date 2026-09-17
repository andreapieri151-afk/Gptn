import type { CustomModel, Settings, ThemeMode } from '@shared/types'
import { JsonStore } from './jsonStore'

export const SETTINGS_SCHEMA_VERSION = 1

/** Curated Gemini models offered out of the box; the API list can extend them. */
export const BUILTIN_MODELS: Array<{ id: string; label: string }> = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
]

export const DEFAULT_MODEL = BUILTIN_MODELS[0].id

export function defaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme: 'system',
    sidebarWidth: 268,
    sidebarCollapsed: false,
    model: DEFAULT_MODEL,
    temperature: 1,
    topP: null,
    maxOutputTokens: null,
    systemInstruction: '',
    baseUrl: '',
    startBehavior: 'restore-last',
    streaming: true,
    safetyMode: 'default',
    showTokenUsage: false,
    customModels: [],
    lastConversationId: null
  }
}

const themes: ThemeMode[] = ['system', 'light', 'dark']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function nullableNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return Math.min(max, Math.max(min, value))
}

/** Validates and repairs a settings object coming from disk, IPC or an older version. */
export function normalizeSettings(raw: unknown, fallback: Settings = defaultSettings()): Settings {
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<Settings> & Record<string, unknown>
  const customModels: CustomModel[] = Array.isArray(value.customModels)
    ? value.customModels
        .map((model) => {
          if (!model || typeof model !== 'object') return null
          const entry = model as { id?: unknown; label?: unknown }
          if (typeof entry.id !== 'string' || !entry.id.trim()) return null
          const id = entry.id.trim()
          const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id
          return { id, label }
        })
        .filter((model): model is CustomModel => model !== null)
    : []

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme: themes.includes(value.theme as ThemeMode) ? (value.theme as ThemeMode) : fallback.theme,
    sidebarWidth: clampNumber(value.sidebarWidth, 220, 460, fallback.sidebarWidth),
    sidebarCollapsed: typeof value.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : fallback.sidebarCollapsed,
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : fallback.model,
    temperature: clampNumber(value.temperature, 0, 2, fallback.temperature),
    topP: nullableNumber(value.topP, 0, 1),
    maxOutputTokens:
      typeof value.maxOutputTokens === 'number' && value.maxOutputTokens > 0
        ? Math.floor(value.maxOutputTokens)
        : null,
    systemInstruction: typeof value.systemInstruction === 'string' ? value.systemInstruction.slice(0, 8000) : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim().replace(/\/+$/, '') : '',
    startBehavior: value.startBehavior === 'new-chat' ? 'new-chat' : 'restore-last',
    streaming: typeof value.streaming === 'boolean' ? value.streaming : fallback.streaming,
    safetyMode: value.safetyMode === 'off' ? 'off' : 'default',
    showTokenUsage: value.showTokenUsage === true,
    customModels,
    lastConversationId: typeof value.lastConversationId === 'string' ? value.lastConversationId : null
  }
}

export class SettingsRepository {
  private readonly store: JsonStore<Settings>

  constructor(file: string) {
    this.store = new JsonStore<Settings>(file, defaultSettings, (raw, fallback) => normalizeSettings(raw, fallback))
  }

  async load(): Promise<Settings> {
    return this.store.load()
  }

  get(): Settings {
    return this.store.get()
  }

  update(patch: Partial<Settings>): Settings {
    const merged = normalizeSettings({ ...this.store.get(), ...patch }, this.store.get())
    this.store.set(merged)
    return merged
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}
