/**
 * Browser-only fallback implementation of the GPTN bridge.
 *
 * It is used when the renderer runs outside Electron — i.e. `npm run dev:preview`,
 * which exists purely to review the interface in a browser. Data lives in
 * localStorage and answers are scripted, so the UI clearly flags "Preview mode":
 * it must never be mistaken for the real, Gemini-powered desktop app.
 */
import type { GptnApi, DataStats } from '@shared/api'
import type { UiCommand } from '@shared/ipc'
import type {
  Conversation,
  ConversationsChangedReason,
  ConversationSummary,
  ModelInfo,
  Settings,
  StreamDeltaEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  SecretsStatus,
  TestKeyFailure,
  TestKeyResult
} from '@shared/types'
import { deriveTitle, previewOf, searchConversations } from '@shared/text'
import { genId } from './id'

const STORAGE_KEY = 'gptn.preview.v1'

interface PreviewData {
  conversations: Conversation[]
  settings: Settings
}

const defaultSettings = (): Settings => ({
  schemaVersion: 1,
  theme: 'system',
  sidebarWidth: 268,
  sidebarCollapsed: false,
  model: 'gemini-2.5-flash',
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
})

function load(): PreviewData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PreviewData
      if (Array.isArray(parsed.conversations)) {
        return { conversations: parsed.conversations, settings: { ...defaultSettings(), ...parsed.settings } }
      }
    }
  } catch {
    /* start fresh */
  }
  return { conversations: [], settings: defaultSettings() }
}

const PREVIEW_ANSWER = `**Preview mode** — this window is the interface only, running outside the desktop app.

Open the packaged **GPTN.app** (or \`npm run dev\`) and add your Gemini API key in **Settings → AI** to get real answers from the model.

\`\`\`ts
// The real app talks to Gemini straight from the main process
const stream = await gemini.streamGenerate({ model: 'gemini-2.5-flash', contents })
\`\`\`
`

export function createPreviewBridge(): GptnApi {
  const data = load()
  const listeners = {
    settings: new Set<(settings: Settings) => void>(),
    conversations: new Set<(change: { reason: ConversationsChangedReason }) => void>(),
    delta: new Set<(event: StreamDeltaEvent) => void>(),
    done: new Set<(event: StreamDoneEvent) => void>(),
    error: new Set<(event: StreamErrorEvent) => void>(),
    command: new Set<(command: UiCommand) => void>()
  }

  const persist = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* ignore quota errors in preview mode */
    }
  }

  const summarize = (conversation: Conversation): ConversationSummary => {
    const last = conversation.messages[conversation.messages.length - 1]
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      preview: last ? previewOf(last.content) : '',
      model: conversation.model
    }
  }

  const timers = new Map<string, number>()
  const log = (...args: unknown[]): void => console.info('[GPTN preview]', ...args)

  return {
    app: {
      info: async () => ({
        name: 'GPTN',
        version: '1.0.0-preview',
        electron: 'n/a',
        chrome: navigator.userAgent,
        node: 'n/a',
        platform: 'web',
        arch: 'n/a',
        userDataPath: 'localStorage',
        isDev: true
      }),
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
      openPath: async (path: string) => {
        log('openPath', path)
        return false
      },
      onCommand: (handler: (command: UiCommand) => void) => {
        listeners.command.add(handler)
        return () => {
          listeners.command.delete(handler)
        }
      }
    },
    settings: {
      get: async () => data.settings,
      update: async (patch: Partial<Settings>) => {
        data.settings = { ...data.settings, ...patch }
        persist()
        listeners.settings.forEach((handler) => handler(data.settings))
        return data.settings
      },
      onChanged: (handler: (settings: Settings) => void) => {
        listeners.settings.add(handler)
        return () => {
          listeners.settings.delete(handler)
        }
      }
    },
    secrets: {
      status: async (): Promise<SecretsStatus> => ({
        hasApiKey: false,
        maskedKey: null,
        storage: 'memory',
        encryptionAvailable: false
      }),
      setApiKey: async (): Promise<SecretsStatus> => {
        log('API keys can only be stored by the desktop app')
        return { hasApiKey: false, maskedKey: null, storage: 'memory', encryptionAvailable: false }
      },
      clearApiKey: async (): Promise<SecretsStatus> => ({
        hasApiKey: false,
        maskedKey: null,
        storage: 'memory',
        encryptionAvailable: false
      }),
      test: async (): Promise<TestKeyResult | TestKeyFailure> => {
        throw new Error('API keys can only be verified by the desktop app')
      }
    },
    models: {
      list: async (): Promise<ModelInfo[]> => [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'builtin' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', source: 'builtin' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', source: 'builtin' }
      ]
    },
    conversations: {
      list: async () =>
        data.conversations
          .slice()
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .map(summarize),
      get: async (id: string) => data.conversations.find((conversation) => conversation.id === id) ?? null,
      create: async (options?: { model?: string; title?: string }) => {
        const now = new Date().toISOString()
        const conversation: Conversation = {
          id: genId(),
          title: options?.title ?? 'New chat',
          createdAt: now,
          updatedAt: now,
          model: options?.model ?? data.settings.model,
          messages: []
        }
        data.conversations.unshift(conversation)
        persist()
        listeners.conversations.forEach((handler) => handler({ reason: 'created' }))
        return conversation
      },
      rename: async (id: string, title: string) => {
        const conversation = data.conversations.find((item) => item.id === id)
        if (!conversation) return null
        conversation.title = title.trim() || conversation.title
        conversation.updatedAt = new Date().toISOString()
        persist()
        listeners.conversations.forEach((handler) => handler({ reason: 'renamed' }))
        return summarize(conversation)
      },
      remove: async (id: string) => {
        data.conversations = data.conversations.filter((conversation) => conversation.id !== id)
        persist()
        listeners.conversations.forEach((handler) => handler({ reason: 'deleted' }))
      },
      removeAll: async () => {
        const count = data.conversations.length
        data.conversations = []
        persist()
        listeners.conversations.forEach((handler) => handler({ reason: 'deleted-all' }))
        return count
      },
      search: async (query: string) => searchConversations(data.conversations, query),
      onChanged: (handler: (change: { reason: ConversationsChangedReason }) => void) => {
        listeners.conversations.add(handler)
        return () => {
          listeners.conversations.delete(handler)
        }
      }
    },
    chat: {
      start: async (request) => {
        const conversation = data.conversations.find((item) => item.id === request.conversationId)
        if (!conversation) return
        conversation.messages = request.messages.map((message) =>
          message.role === 'assistant' ? { ...message, content: '', state: 'streaming' as const } : message
        )
        if (conversation.title === 'New chat') {
          const firstUser = request.messages.find((message) => message.role === 'user')
          if (firstUser) conversation.title = deriveTitle(firstUser.content)
        }
        conversation.updatedAt = new Date().toISOString()
        persist()

        const assistantId = [...conversation.messages].reverse().find((m) => m.role === 'assistant')?.id
        const tokens = PREVIEW_ANSWER.split(/(\s+)/)
        let index = 0
        const tick = (): void => {
          index += 3
          const text = tokens.slice(0, index).join('')
          listeners.delta.forEach((handler) => handler({ requestId: request.requestId, text: tokens.slice(index - 3, index).join('') }))
          if (index >= tokens.length) {
            timers.delete(request.requestId)
            conversation.messages = conversation.messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: PREVIEW_ANSWER, state: 'complete' as const, model: request.model }
                : message
            )
            conversation.updatedAt = new Date().toISOString()
            persist()
            listeners.done.forEach((handler) =>
              handler({
                requestId: request.requestId,
                conversationId: conversation.id,
                text: PREVIEW_ANSWER,
                model: request.model,
                durationMs: 1200,
                interrupted: false,
                usage: { promptTokens: 12, outputTokens: 96, totalTokens: 108 }
              })
            )
            listeners.conversations.forEach((handler) => handler({ reason: 'updated' }))
            return
          }
          if (index > tokens.length) return
          void text
          timers.set(request.requestId, window.setTimeout(tick, 45))
        }
        timers.set(request.requestId, window.setTimeout(tick, 260))
      },
      stop: async (requestId: string) => {
        const timer = timers.get(requestId)
        if (timer) {
          clearTimeout(timer)
          timers.delete(requestId)
          return true
        }
        return false
      },
      onDelta: (handler) => {
        listeners.delta.add(handler)
        return () => {
          listeners.delta.delete(handler)
        }
      },
      onDone: (handler) => {
        listeners.done.add(handler)
        return () => {
          listeners.done.delete(handler)
        }
      },
      onError: (handler) => {
        listeners.error.add(handler)
        return () => {
          listeners.error.delete(handler)
        }
      }
    },
    data: {
      export: async () => ({ canceled: true, count: 0 }),
      import: async () => ({ canceled: true, imported: 0 }),
      revealFolder: async () => log('revealFolder'),
      stats: async (): Promise<DataStats> => ({
        conversations: data.conversations.length,
        messages: data.conversations.reduce((total, conversation) => total + conversation.messages.length, 0),
        databaseBytes: JSON.stringify(data).length,
        databasePath: 'localStorage://gptn.preview.v1',
        oldest: data.conversations.at(-1)?.createdAt ?? null
      })
    },
    window: {
      minimize: () => undefined,
      zoom: () => undefined,
      close: () => undefined
    }
  }
}
