import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { UiCommand } from '@shared/ipc'
import type { GptnApi } from '@shared/api'
import type {
  ChatRequest,
  Conversation,
  ConversationSummary,
  ConversationsChangedReason,
  ExportRequest,
  ExportResult,
  ModelInfo,
  SearchHit,
  SecretsStatus,
  Settings,
  StreamDeltaEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  TestKeyFailure,
  TestKeyResult
} from '@shared/types'
import type { AppInfo, DataStats } from '@shared/api'

/**
 * Subscribes to a main-process event and returns an unsubscribe function,
 * so React effects cannot leak listeners.
 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: GptnApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.app.info) as Promise<AppInfo>,
    openExternal: (url: string) => ipcRenderer.invoke(IPC.app.openExternal, url) as Promise<void>,
    openPath: (path: string) => ipcRenderer.invoke('app:open-path', path) as Promise<boolean>,
    onCommand: (handler: (command: UiCommand) => void) => subscribe<UiCommand>(IPC.app.navigate, handler)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get) as Promise<Settings>,
    update: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settings.update, patch) as Promise<Settings>,
    onChanged: (handler: (settings: Settings) => void) => subscribe<Settings>(IPC.settings.changed, handler)
  },
  secrets: {
    status: () => ipcRenderer.invoke(IPC.secrets.status) as Promise<SecretsStatus>,
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.secrets.setApiKey, key) as Promise<SecretsStatus>,
    clearApiKey: () => ipcRenderer.invoke(IPC.secrets.clearApiKey) as Promise<SecretsStatus>,
    test: (model?: string) =>
      ipcRenderer.invoke(IPC.secrets.test, model) as Promise<TestKeyResult | TestKeyFailure>
  },
  models: {
    list: (force = false) => ipcRenderer.invoke(IPC.models.list, force) as Promise<ModelInfo[]>
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversations.list) as Promise<ConversationSummary[]>,
    get: (id: string) => ipcRenderer.invoke(IPC.conversations.get, id) as Promise<Conversation | null>,
    create: (options?: { model?: string; title?: string }) =>
      ipcRenderer.invoke(IPC.conversations.create, options ?? {}) as Promise<Conversation>,
    rename: (id: string, title: string) =>
      ipcRenderer.invoke(IPC.conversations.rename, id, title) as Promise<ConversationSummary | null>,
    remove: (id: string) => ipcRenderer.invoke(IPC.conversations.remove, id) as Promise<void>,
    removeAll: () => ipcRenderer.invoke(IPC.conversations.removeAll) as Promise<number>,
    search: (query: string) => ipcRenderer.invoke(IPC.conversations.search, query) as Promise<SearchHit[]>,
    onChanged: (handler: (change: { reason: ConversationsChangedReason }) => void) =>
      subscribe<{ reason: ConversationsChangedReason }>(IPC.conversations.changed, handler)
  },
  chat: {
    start: (request: ChatRequest) => ipcRenderer.invoke(IPC.chat.start, request) as Promise<void>,
    stop: (requestId: string) => ipcRenderer.invoke(IPC.chat.stop, requestId) as Promise<boolean>,
    onDelta: (handler: (event: StreamDeltaEvent) => void) => subscribe<StreamDeltaEvent>(IPC.chat.delta, handler),
    onDone: (handler: (event: StreamDoneEvent) => void) => subscribe<StreamDoneEvent>(IPC.chat.done, handler),
    onError: (handler: (event: StreamErrorEvent) => void) => subscribe<StreamErrorEvent>(IPC.chat.error, handler)
  },
  data: {
    export: (request: ExportRequest) => ipcRenderer.invoke(IPC.data.export, request) as Promise<ExportResult>,
    import: () => ipcRenderer.invoke(IPC.data.import) as Promise<{ canceled: boolean; imported: number }>,
    revealFolder: () => ipcRenderer.invoke(IPC.data.revealFolder) as Promise<void>,
    stats: () => ipcRenderer.invoke(IPC.data.stats) as Promise<DataStats>
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    zoom: () => ipcRenderer.send(IPC.window.zoom),
    close: () => ipcRenderer.send(IPC.window.close)
  }
}

contextBridge.exposeInMainWorld('gptn', api)
