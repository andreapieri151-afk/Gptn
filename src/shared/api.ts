import type {
  AppInfo,
  ChatRequest,
  Conversation,
  ConversationSummary,
  ConversationsChangedReason,
  CustomModel,
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
import type { UiCommand } from '@shared/ipc'

export interface DataStats {
  conversations: number
  messages: number
  databaseBytes: number
  databasePath: string
  oldest: string | null
}

/** Shape exposed to the renderer on window.gptn — nothing else crosses the bridge. */
export interface GptnApi {
  app: {
    info(): Promise<AppInfo>
    /** Opens an http(s)/mailto link in the user's default browser. */
    openExternal(url: string): Promise<void>
    onCommand(handler: (command: UiCommand) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    onChanged(handler: (settings: Settings) => void): () => void
  }
  secrets: {
    status(): Promise<SecretsStatus>
    setApiKey(key: string): Promise<SecretsStatus>
    clearApiKey(): Promise<SecretsStatus>
    /**
     * Live call to Gemini — verifies key + model.
     * Pass `key` to check a key before it is stored (first-run onboarding);
     * without it the key already in the Keychain is used.
     */
    test(model?: string, key?: string): Promise<TestKeyResult | TestKeyFailure>
  }
  models: {
    /** Queries the API when a key is available, otherwise returns the curated list. */
    list(force?: boolean): Promise<ModelInfo[]>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    get(id: string): Promise<Conversation | null>
    create(options?: { model?: string; title?: string }): Promise<Conversation>
    rename(id: string, title: string): Promise<ConversationSummary | null>
    remove(id: string): Promise<void>
    removeAll(): Promise<number>
    search(query: string): Promise<SearchHit[]>
    onChanged(handler: (change: { reason: ConversationsChangedReason }) => void): () => void
  }
  chat: {
    start(request: ChatRequest): Promise<void>
    stop(requestId: string): Promise<boolean>
    onDelta(handler: (event: StreamDeltaEvent) => void): () => void
    onDone(handler: (event: StreamDoneEvent) => void): () => void
    onError(handler: (event: StreamErrorEvent) => void): () => void
  }
  data: {
    export(request: ExportRequest): Promise<ExportResult>
    import(): Promise<{ canceled: boolean; imported: number }>
    revealFolder(): Promise<void>
    stats(): Promise<DataStats>
  }
}

export type { AppInfo, Conversation, ConversationSummary, ModelInfo, Settings, SecretsStatus, CustomModel }
