/**
 * Shared domain types for GPTN.
 * These types are the contract between the main process (persistence + AI service)
 * and the renderer (UI). No Electron or browser specific API is referenced here.
 */

export type ThemeMode = 'system' | 'light' | 'dark'

export type Role = 'user' | 'assistant'

/** Lifecycle state of a message. Streamed answers move streaming -> complete. */
export type MessageState = 'streaming' | 'complete' | 'error' | 'interrupted'

export interface MessageError {
  code: string
  /** Short human readable title, e.g. "Something went wrong". */
  title: string
  /** One line explanation the user can act on. */
  message: string
  /** Optional technical detail, collapsed behind a debug disclosure in the UI. */
  detail?: string
  retryable: boolean
}

export interface TokenUsage {
  promptTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: string
  /** Model that produced the answer (assistant messages only). */
  model?: string
  state: MessageState
  error?: MessageError
  usage?: TokenUsage
  /** Reasoning/thought summary when the model returns one. */
  thought?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model: string
  messages: ChatMessage[]
  /** Archived conversations are hidden from the main list. */
  archived?: boolean
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** First ~140 chars of the last message, used for list previews/search. */
  preview: string
  model: string
}

export interface SearchHit {
  conversationId: string
  title: string
  updatedAt: string
  /** Matching snippet from the conversation body, when the match is not in the title. */
  snippet?: string
  titleMatch: boolean
}

export interface ModelInfo {
  /** Full API id, e.g. "gemini-2.5-flash". */
  id: string
  /** Name shown in the UI. */
  label: string
  description?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
  source: 'api' | 'builtin' | 'custom'
}

export type SecretStorageKind = 'keychain' | 'memory'

export interface SecretsStatus {
  hasApiKey: boolean
  /** Masked preview of the stored key, e.g. "AIza••••••••7fQ2". */
  maskedKey: string | null
  /** `keychain` = encrypted at rest through the macOS Keychain (safeStorage). */
  storage: SecretStorageKind
  encryptionAvailable: boolean
}

export type StartBehavior = 'restore-last' | 'new-chat'

export interface CustomModel {
  id: string
  label: string
}

export interface Settings {
  schemaVersion: number
  theme: ThemeMode
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Gemini model id used for new conversations. */
  model: string
  temperature: number
  topP: number | null
  maxOutputTokens: number | null
  /** Extra instructions prepended to every conversation. */
  systemInstruction: string
  /** Advanced: override the API endpoint (proxy / enterprise gateway). */
  baseUrl: string
  startBehavior: StartBehavior
  /** Stream tokens while Gemini generates them. */
  streaming: boolean
  /** Safety filters: 'default' uses the API defaults, 'off' disables blocking. */
  safetyMode: 'default' | 'off'
  showTokenUsage: boolean
  customModels: CustomModel[]
  /** Id of the conversation to reopen on launch (when startBehavior is restore-last). */
  lastConversationId: string | null
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  userDataPath: string
  isDev: boolean
}

export interface TestKeyResult {
  ok: true
  model: string
  latencyMs: number
  /** Model ids returned by the API for this key (used to refresh the model picker). */
  models: ModelInfo[]
}

export interface TestKeyFailure {
  ok: false
  error: MessageError
  latencyMs: number
}

export interface ChatRequest {
  requestId: string
  conversationId: string
  /** Full conversation history in UI order. */
  messages: ChatMessage[]
  model: string
}

export interface StreamDeltaEvent {
  requestId: string
  text: string
  thought?: string
}

export interface StreamDoneEvent {
  requestId: string
  conversationId: string
  text: string
  thought?: string
  model: string
  usage?: TokenUsage
  /** Wall clock duration of the request in ms. */
  durationMs: number
  /** True when the stream ended because the user pressed Stop. */
  interrupted: boolean
  /** Gemini finish reason, e.g. MAX_TOKENS when the answer was truncated. */
  finishReason?: string
}

export interface StreamErrorEvent {
  requestId: string
  conversationId: string
  error: MessageError
  /** Text generated before the failure, kept visible in the transcript. */
  partialText?: string
  thought?: string
}

export interface ExportRequest {
  format: 'markdown' | 'json'
  conversationIds: string[]
  /** When omitted a save dialog is shown. Used by tests to avoid dialogs. */
  targetPath?: string
}

export interface ExportResult {
  canceled: boolean
  path?: string
  count: number
}

export type ConversationsChangedReason =
  | 'created'
  | 'updated'
  | 'renamed'
  | 'deleted'
  | 'deleted-all'
  | 'imported'
