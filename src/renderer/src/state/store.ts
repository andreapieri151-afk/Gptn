import { create } from 'zustand'
import type {
  ChatMessage,
  ConversationSummary,
  MessageError,
  ModelInfo,
  SecretsStatus,
  Settings,
  ThemeMode
} from '@shared/types'
import type { AppInfo, DataStats } from '@shared/api'
import { api, isDesktop } from '@renderer/platform/api'
import { genId } from '@renderer/platform/id'
import { deriveTitle } from '@shared/text'

export type SettingsSection = 'general' | 'ai' | 'data' | 'about'

export interface Toast {
  id: string
  tone: 'info' | 'success' | 'error'
  message: string
}

interface ChatState {
  ready: boolean
  previewMode: boolean
  appInfo: AppInfo | null
  settings: Settings | null
  secrets: SecretsStatus | null
  models: ModelInfo[]
  dataStats: DataStats | null

  conversations: ConversationSummary[]
  activeId: string | null
  messages: ChatMessage[]
  activeModel: string

  /** In-flight request bookkeeping. */
  requestId: string | null
  streamingMessageId: string | null
  generatingSince: number | null

  /** Last failure shown as a banner under the composer. */
  lastError: MessageError | null

  settingsOpen: boolean
  settingsSection: SettingsSection
  paletteOpen: boolean
  sidebarCollapsed: boolean
  toasts: Toast[]
  modelsLoading: boolean

  bootstrap(): Promise<void>
  refreshConversations(): Promise<void>
  refreshModels(force?: boolean): Promise<void>
  openConversation(id: string): Promise<void>
  newChat(): Promise<void>
  sendMessage(content: string): Promise<void>
  stopGeneration(): Promise<void>
  retryLast(): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  deleteAllConversations(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  setTheme(theme: ThemeMode): Promise<void>
  saveApiKey(key: string): Promise<SecretsStatus | null>
  clearApiKey(): Promise<void>
  runKeyTest(model?: string): Promise<{ ok: boolean; error?: MessageError; model?: string; latencyMs?: number }>
  exportConversations(format: 'markdown' | 'json', ids?: string[]): Promise<void>
  importConversations(): Promise<void>
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  setPaletteOpen(open: boolean): void
  toggleSidebar(): void
  setSidebarWidth(width: number, persist?: boolean): Promise<void>
  clearError(): void
  pushToast(message: string, tone?: Toast['tone']): void
  dismissToast(id: string): void
  applyDelta(text: string, thought?: string): void
  completeStream(payload: {
    requestId: string
    text: string
    interrupted: boolean
    usage?: ChatMessage['usage']
    finishReason?: string
    thought?: string
  }): void
  failStream(payload: { requestId: string; error: MessageError; partialText?: string; thought?: string }): void
}

const DEFAULT_SETTINGS_FALLBACK: Settings = {
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

function newMessage(role: ChatMessage['role'], content: string, state: ChatMessage['state'] = 'complete'): ChatMessage {
  return { id: genId(), role, content, createdAt: new Date().toISOString(), state }
}

export const useChatStore = create<ChatState>((set, get) => ({
  ready: false,
  previewMode: !isDesktop,
  appInfo: null,
  settings: null,
  secrets: null,
  models: [],
  dataStats: null,

  conversations: [],
  activeId: null,
  messages: [],
  activeModel: DEFAULT_SETTINGS_FALLBACK.model,

  requestId: null,
  streamingMessageId: null,
  generatingSince: null,
  lastError: null,

  settingsOpen: false,
  settingsSection: 'general',
  paletteOpen: false,
  sidebarCollapsed: false,
  toasts: [],
  modelsLoading: false,

  async bootstrap() {
    const [settings, secrets, conversations, models, appInfo] = await Promise.all([
      api.settings.get(),
      api.secrets.status(),
      api.conversations.list(),
      api.models.list(),
      api.app.info()
    ])
    set({
      settings,
      secrets,
      conversations,
      models,
      appInfo,
      activeModel: settings.model,
      sidebarCollapsed: settings.sidebarCollapsed,
      ready: true
    })

    // Restore the previous session: last conversation, or restore an empty draft.
    const lastId = settings.lastConversationId
    if (settings.startBehavior === 'restore-last' && lastId) {
      const conversation = await api.conversations.get(lastId)
      if (conversation) {
        set({ activeId: conversation.id, messages: conversation.messages, activeModel: conversation.model })
        return
      }
    }
    await get().newChat()
  },

  async refreshConversations() {
    const conversations = await api.conversations.list()
    set({ conversations })
  },

  async refreshModels(force = false) {
    set({ modelsLoading: true })
    try {
      const models = await api.models.list(force)
      if (models.length) set({ models })
    } finally {
      set({ modelsLoading: false })
    }
  },

  async openConversation(id) {
    if (get().activeId === id) return
    if (get().requestId) await get().stopGeneration()
    const conversation = await api.conversations.get(id)
    if (!conversation) {
      await get().refreshConversations()
      return
    }
    set({
      activeId: conversation.id,
      messages: conversation.messages,
      activeModel: conversation.model,
      lastError: null
    })
    const settings = get().settings
    if (settings && settings.lastConversationId !== id) {
      const updated = await api.settings.update({ lastConversationId: id })
      set({ settings: updated })
    }
  },

  async newChat() {
    if (get().requestId) await get().stopGeneration()
    const settings = get().settings ?? DEFAULT_SETTINGS_FALLBACK
    const conversation = await api.conversations.create({ model: settings.model })
    set({
      activeId: conversation.id,
      messages: [],
      activeModel: conversation.model,
      lastError: null
    })
    await get().refreshConversations()
    const updated = await api.settings.update({ lastConversationId: conversation.id })
    set({ settings: updated })
  },

  async sendMessage(content) {
    const text = content.trim()
    if (!text || get().requestId) return

    let conversationId = get().activeId
    if (!conversationId) {
      const conversation = await api.conversations.create({ model: get().activeModel })
      conversationId = conversation.id
      set({ activeId: conversation.id, messages: [] })
    }

    const userMessage = newMessage('user', text)
    const assistantMessage = newMessage('assistant', '', 'streaming')
    const messages = [...get().messages, userMessage, assistantMessage]
    const requestId = genId()

    set({
      messages,
      requestId,
      streamingMessageId: assistantMessage.id,
      generatingSince: Date.now(),
      lastError: null
    })

    // The title is derived locally from the first message so the sidebar reacts instantly.
    if (messages.filter((message) => message.role === 'user').length === 1) {
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, title: deriveTitle(text) } : conversation
        )
      }))
    }

    try {
      await api.chat.start({
        requestId,
        conversationId,
        messages,
        model: get().activeModel
      })
    } catch (error) {
      get().failStream({
        requestId,
        error: {
          code: 'IPC',
          title: 'Message not sent',
          message: 'GPTN could not reach its local service. Restart the app and try again.',
          detail: (error as Error).message,
          retryable: true
        }
      })
    }
  },

  async stopGeneration() {
    const requestId = get().requestId
    if (!requestId) return
    await api.chat.stop(requestId)
  },

  async retryLast() {
    const messages = get().messages
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    // Drop the failed assistant turn and retry the same prompt.
    const trimmed: ChatMessage[] = []
    for (const message of messages) {
      if (message === lastUser) break
      trimmed.push(message)
    }
    set({ messages: trimmed, lastError: null })
    await get().sendMessage(lastUser.content)
  },

  async renameConversation(id, title) {
    await api.conversations.rename(id, title)
    await get().refreshConversations()
  },

  async deleteConversation(id) {
    if (get().activeId === id && get().requestId) await get().stopGeneration()
    await api.conversations.remove(id)
    if (get().activeId === id) {
      const remaining = await api.conversations.list()
      if (remaining.length) await get().openConversation(remaining[0].id)
      else await get().newChat()
    }
    await get().refreshConversations()
  },

  async deleteAllConversations() {
    if (get().requestId) await get().stopGeneration()
    const removed = await api.conversations.removeAll()
    await get().refreshConversations()
    await get().newChat()
    get().pushToast(`${removed} conversation${removed === 1 ? '' : 's'} deleted`, 'success')
  },

  async updateSettings(patch) {
    const settings = await api.settings.update(patch)
    set({ settings, sidebarCollapsed: settings.sidebarCollapsed })
    if (patch.model && patch.model !== get().activeModel) set({ activeModel: patch.model })
  },

  async setTheme(theme) {
    await get().updateSettings({ theme })
  },

  async saveApiKey(key) {
    try {
      const status = await api.secrets.setApiKey(key)
      set({ secrets: status })
      await get().refreshModels(true)
      return status
    } catch (error) {
      const detail = (error as Error).message
      get().pushToast(detail, 'error')
      return null
    }
  },

  async clearApiKey() {
    const status = await api.secrets.clearApiKey()
    set({ secrets: status })
    await get().refreshModels(true)
  },

  async runKeyTest(model) {
    try {
      const result = await api.secrets.test(model)
      if (result.ok) return { ok: true, model: result.model, latencyMs: result.latencyMs }
      return { ok: false, error: result.error }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          title: 'Something went wrong',
          message: 'GPTN could not run the connection test. Make sure the app is running from the desktop build.',
          detail: (error as Error).message,
          retryable: true
        }
      }
    }
  },

  async exportConversations(format, ids = []) {
    try {
      await get().refreshConversations()
      const result = await api.data.export({ format, conversationIds: ids })
      if (result.canceled) return
      get().pushToast(`Exported ${result.count} conversation${result.count === 1 ? '' : 's'}`, 'success')
    } catch (error) {
      get().pushToast(`Export failed: ${(error as Error).message}`, 'error')
    }
  },

  async importConversations() {
    try {
      const result = await api.data.import()
      if (result.canceled) return
      await get().refreshConversations()
      get().pushToast(`Imported ${result.imported} conversation${result.imported === 1 ? '' : 's'}`, 'success')
    } catch (error) {
      const message = (error as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, '')
      get().pushToast(message, 'error')
    }
  },

  openSettings(section = 'general') {
    set({ settingsOpen: true, settingsSection: section })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  toggleSidebar() {
    const collapsed = !get().sidebarCollapsed
    set({ sidebarCollapsed: collapsed })
    void api.settings.update({ sidebarCollapsed: collapsed })
  },

  async setSidebarWidth(width, persist = true) {
    const clamped = Math.min(460, Math.max(220, Math.round(width)))
    set((state) => ({ settings: state.settings ? { ...state.settings, sidebarWidth: clamped } : state.settings }))
    if (persist) await api.settings.update({ sidebarWidth: clamped })
  },

  clearError() {
    set({ lastError: null })
  },

  pushToast(message, tone = 'info') {
    const toast: Toast = { id: genId(), tone, message }
    set((state) => ({ toasts: [...state.toasts, toast] }))
    setTimeout(() => get().dismissToast(toast.id), 5200)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  applyDelta(text, thought) {
    const messageId = get().streamingMessageId
    if (!messageId || (!text && !thought)) return
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: text ? message.content + text : message.content,
              ...(thought ? { thought: (message.thought ?? '') + thought } : {})
            }
          : message
      )
    }))
  },

  completeStream({ requestId, text, interrupted, usage, finishReason, thought }) {
    if (get().requestId !== requestId) return
    const messageId = get().streamingMessageId
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: text || message.content,
              state: interrupted ? ('interrupted' as const) : ('complete' as const),
              ...(usage ? { usage } : {}),
              ...(thought ? { thought } : {}),
              ...(finishReason ? { error: undefined } : {})
            }
          : message
      ),
      requestId: null,
      streamingMessageId: null,
      generatingSince: null,
      lastError:
        finishReason === 'MAX_TOKENS'
          ? {
              code: 'MAX_TOKENS',
              title: 'Answer truncated',
              message: 'Gemini stopped because the maximum output length was reached. Raise the limit in Settings → AI.',
              retryable: false
            }
          : null
    }))
    void get().refreshConversations()
  },

  failStream({ requestId, error, partialText, thought }) {
    if (get().requestId !== requestId && error.code !== 'IPC') return
    const messageId = get().streamingMessageId
    const apiKeyMissing = error.code === 'NO_API_KEY'
    set((state) => ({
      // Without an API key the assistant turn is removed: nothing was generated.
      messages: apiKeyMissing
        ? state.messages.filter((message) => message.id !== messageId)
        : state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: partialText ?? message.content,
                  state: 'error' as const,
                  error,
                  ...(thought ? { thought } : {})
                }
              : message
          ),
      requestId: null,
      streamingMessageId: null,
      generatingSince: null,
      lastError: error
    }))
    void get().refreshConversations()
  }
}))

/** Selectors used across components. */
export const selectIsGenerating = (state: ChatState): boolean => state.requestId !== null
export const selectActiveSummary = (state: ChatState): ConversationSummary | undefined =>
  state.conversations.find((conversation) => conversation.id === state.activeId)
