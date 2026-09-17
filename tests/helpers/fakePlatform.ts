import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GptnApi, DataStats } from '@shared/api'
import type {
  ChatRequest,
  TestKeyFailure,
  Conversation,
  ConversationSummary,
  ConversationsChangedReason,
  ModelInfo,
  SearchHit,
  SecretsStatus,
  Settings,
  StreamDeltaEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  TestKeyResult
} from '@shared/types'
import type { UiCommand } from '@shared/ipc'

type Listener<T> = (payload: T) => void

export interface FakePlatform {
  api: GptnApi
  settings: Settings
  conversations: Conversation[]
  requests: ChatRequest[]
  stopped: string[]
  openedUrls: string[]
  /** Keys handed to `secrets.setApiKey`, in order. */
  savedKeys: string[]
  /** Keys handed to `secrets.test`, in order (they must never be stored first). */
  testedKeys: string[]
  /** Simulates a machine without a stored key (first run). */
  setHasApiKey: (value: boolean) => void
  /** Simulates the outcome of `secrets.test`. */
  setKeyTestResult: (result: TestKeyResult | TestKeyFailure) => void
  emitDelta: (event: StreamDeltaEvent) => void
  emitDone: (event: StreamDoneEvent) => void
  emitError: (event: StreamErrorEvent) => void
  emitConversationsChanged: (reason: ConversationsChangedReason) => void
  emitCommand: (command: UiCommand) => void
  reset: () => void
}

let registered: FakePlatform | null = null

export function registerFakePlatform(platform: FakePlatform): void {
  registered = platform
}

export function getFakePlatform(): FakePlatform {
  if (!registered) throw new Error('fake platform not registered')
  return registered
}

function defaultSettings(): Settings {
  return {
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
  }
}

function defaultKeyTest(): TestKeyResult {
  return {
    ok: true,
    model: 'gemini-2.5-flash',
    latencyMs: 123,
    models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'api' }]
  }
}

const packageVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
).version

let idCounter = 0
const nextId = (): string => `id-${++idCounter}`

function summarize(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1]
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: last ? last.content.replace(/\s+/g, ' ').slice(0, 140) : '',
    model: conversation.model
  }
}

/** A complete in-memory stand-in for the preload bridge, used by renderer tests. */
export function createFakePlatform(hasApiKey = true): FakePlatform {
  const settings = defaultSettings()
  const conversations: Conversation[] = []
  const requests: ChatRequest[] = []
  const stopped: string[] = []
  const openedUrls: string[] = []
  const savedKeys: string[] = []
  const testedKeys: string[] = []
  let keyTest: TestKeyResult | TestKeyFailure = defaultKeyTest()

  const deltaListeners = new Set<Listener<StreamDeltaEvent>>()
  const doneListeners = new Set<Listener<StreamDoneEvent>>()
  const errorListeners = new Set<Listener<StreamErrorEvent>>()
  const conversationsListeners = new Set<Listener<{ reason: ConversationsChangedReason }>>()
  const settingsListeners = new Set<Listener<Settings>>()
  const commandListeners = new Set<Listener<UiCommand>>()

  const status = (): SecretsStatus => ({
    hasApiKey,
    maskedKey: hasApiKey ? 'AIza••••••••test' : null,
    storage: 'keychain',
    encryptionAvailable: true
  })

  const api: GptnApi = {
    app: {
      info: async () => ({
        name: 'GPTN',
        version: packageVersion,
        electron: '44.0.0',
        chrome: '140',
        node: '22',
        platform: 'darwin',
        arch: 'arm64',
        userDataPath: '/tmp/gptn',
        isDev: true
      }),
      openExternal: async (url: string) => {
        openedUrls.push(url)
      },
      onCommand: (handler) => {
        commandListeners.add(handler)
        return () => {
          commandListeners.delete(handler)
        }
      }
    },
    settings: {
      get: async () => ({ ...settings }),
      update: async (patch) => {
        Object.assign(settings, patch)
        settingsListeners.forEach((listener) => listener({ ...settings }))
        return { ...settings }
      },
      onChanged: (handler) => {
        settingsListeners.add(handler)
        return () => {
          settingsListeners.delete(handler)
        }
      }
    },
    secrets: {
      status: async () => status(),
      setApiKey: async (key: string) => {
        savedKeys.push(key)
        hasApiKey = !!key.trim()
        return status()
      },
      clearApiKey: async () => {
        hasApiKey = false
        return status()
      },
      test: async (_model?: string, key?: string): Promise<TestKeyResult | TestKeyFailure> => {
        if (key) testedKeys.push(key)
        return keyTest
      }
    },
    models: {
      list: async (): Promise<ModelInfo[]> => [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'builtin' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', source: 'builtin' }
      ]
    },
    conversations: {
      list: async () =>
        conversations
          .slice()
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .map(summarize),
      get: async (id: string) => conversations.find((conversation) => conversation.id === id) ?? null,
      create: async (options) => {
        const now = new Date().toISOString()
        const conversation: Conversation = {
          id: nextId(),
          title: options?.title ?? 'New chat',
          createdAt: now,
          updatedAt: now,
          model: options?.model ?? settings.model,
          messages: []
        }
        conversations.unshift(conversation)
        conversationsListeners.forEach((listener) => listener({ reason: 'created' }))
        return conversation
      },
      rename: async (id: string, title: string) => {
        const conversation = conversations.find((item) => item.id === id)
        if (!conversation) return null
        conversation.title = title.trim() || conversation.title
        conversationsListeners.forEach((listener) => listener({ reason: 'renamed' }))
        return summarize(conversation)
      },
      remove: async (id: string) => {
        const index = conversations.findIndex((item) => item.id === id)
        if (index >= 0) conversations.splice(index, 1)
        conversationsListeners.forEach((listener) => listener({ reason: 'deleted' }))
      },
      removeAll: async () => {
        const count = conversations.length
        conversations.length = 0
        conversationsListeners.forEach((listener) => listener({ reason: 'deleted-all' }))
        return count
      },
      search: async (query: string): Promise<SearchHit[]> =>
        conversations
          .filter((conversation) => conversation.title.toLowerCase().includes(query.toLowerCase()))
          .map((conversation) => ({
            conversationId: conversation.id,
            title: conversation.title,
            updatedAt: conversation.updatedAt,
            titleMatch: true
          })),
      onChanged: (handler) => {
        conversationsListeners.add(handler)
        return () => {
          conversationsListeners.delete(handler)
        }
      }
    },
    chat: {
      start: async (request) => {
        requests.push(request)
        const conversation = conversations.find((item) => item.id === request.conversationId)
        if (conversation) {
          conversation.messages = request.messages.map((message) => ({ ...message }))
          const firstUser = request.messages.find((message) => message.role === 'user')
          if (conversation.title === 'New chat' && firstUser) conversation.title = firstUser.content.slice(0, 60)
        }
      },
      stop: async (requestId: string) => {
        stopped.push(requestId)
        return true
      },
      onDelta: (handler) => {
        deltaListeners.add(handler)
        return () => {
          deltaListeners.delete(handler)
        }
      },
      onDone: (handler) => {
        doneListeners.add(handler)
        return () => {
          doneListeners.delete(handler)
        }
      },
      onError: (handler) => {
        errorListeners.add(handler)
        return () => {
          errorListeners.delete(handler)
        }
      }
    },
    data: {
      export: async () => ({ canceled: false, path: '/tmp/export.md', count: conversations.length }),
      import: async () => ({ canceled: false, imported: 0 }),
      revealFolder: async () => undefined,
      stats: async (): Promise<DataStats> => ({
        conversations: conversations.length,
        messages: conversations.reduce((total, conversation) => total + conversation.messages.length, 0),
        databaseBytes: 2048,
        databasePath: '/tmp/gptn/conversations.json',
        oldest: null
      })
    },
  }

  return {
    api,
    settings,
    conversations,
    requests,
    stopped,
    openedUrls,
    emitDelta: (event) => deltaListeners.forEach((listener) => listener(event)),
    emitDone: (event) => doneListeners.forEach((listener) => listener(event)),
    emitError: (event) => errorListeners.forEach((listener) => listener(event)),
    emitConversationsChanged: (reason) => conversationsListeners.forEach((listener) => listener({ reason })),
    emitCommand: (command) => commandListeners.forEach((listener) => listener(command)),
    savedKeys,
    testedKeys,
    setHasApiKey: (value) => {
      hasApiKey = value
    },
    setKeyTestResult: (result) => {
      keyTest = result
    },
    reset: () => {
      conversations.length = 0
      requests.length = 0
      stopped.length = 0
      openedUrls.length = 0
      savedKeys.length = 0
      testedKeys.length = 0
      hasApiKey = true
      keyTest = defaultKeyTest()
      Object.assign(settings, defaultSettings())
    }
  }
}
