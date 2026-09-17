import { randomUUID } from 'node:crypto'
import type { Conversation, ConversationSummary, MessageError } from '@shared/types'
import { deriveTitle, previewOf, searchConversations } from '@shared/text'
import { JsonStore } from './jsonStore'
import type { DataStats } from '@shared/api'

interface ConversationsFile {
  version: number
  conversations: Conversation[]
}

const CURRENT_VERSION = 1

export function newId(): string {
  return randomUUID()
}

/** Normalises anything that came from disk or an import file. */
function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<Conversation> & { messages?: unknown }
  if (typeof value.id !== 'string' || !value.id) return null
  const messages = Array.isArray(value.messages)
    ? value.messages.map((message) => normalizeMessage(message)).filter(Boolean as unknown as (m: unknown) => m is Conversation['messages'][number])
    : []
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt
  const firstUser = messages.find((message) => message.role === 'user')
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : deriveTitle(firstUser?.content ?? ''),
    createdAt,
    updatedAt,
    model: typeof value.model === 'string' && value.model ? value.model : 'gemini-2.5-flash',
    messages: messages.map((message) => ({
      ...message,
      // A message left mid-stream by a crash must not look like it is still generating.
      state: message.state === 'streaming' ? 'interrupted' : message.state
    })),
    archived: value.archived === true
  }
}

function normalizeMessage(raw: unknown): Conversation['messages'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.content !== 'string') return null
  const role = value.role === 'assistant' ? 'assistant' : 'user'
  const state =
    value.state === 'streaming' || value.state === 'error' || value.state === 'interrupted'
      ? value.state
      : 'complete'
  return {
    id: typeof value.id === 'string' && value.id ? value.id : newId(),
    role,
    content: value.content,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    state,
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.thought === 'string' ? { thought: value.thought } : {}),
    ...(value.error && typeof value.error === 'object' ? { error: value.error as MessageError } : {}),
    ...(value.usage && typeof value.usage === 'object' ? { usage: value.usage as Conversation['messages'][number]['usage'] } : {})
  }
}

export function summarize(conversation: Conversation): ConversationSummary {
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

/**
 * Conversation repository: pure data logic on top of the JSON store.
 * Nothing here talks to Electron, which keeps it unit-testable.
 */
export class ConversationRepository {
  private readonly store: JsonStore<ConversationsFile>

  constructor(file: string) {
    this.store = new JsonStore<ConversationsFile>(
      file,
      () => ({ version: CURRENT_VERSION, conversations: [] }),
      (raw, fallback) => {
        const value = raw as Partial<ConversationsFile>
        if (!Array.isArray(value.conversations)) return fallback
        return {
          version: CURRENT_VERSION,
          conversations: value.conversations
            .map(normalizeConversation)
            .filter((conversation): conversation is Conversation => conversation !== null)
        }
      }
    )
  }

  async load(): Promise<void> {
    await this.store.load()
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  list(): ConversationSummary[] {
    return this.store
      .get()
      .conversations.slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(summarize)
  }

  get(id: string): Conversation | null {
    const found = this.store.get().conversations.find((conversation) => conversation.id === id)
    return found ? structuredClone(found) : null
  }

  create(options: { model: string; title?: string }): Conversation {
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: newId(),
      title: options.title?.trim() || 'New chat',
      createdAt: now,
      updatedAt: now,
      model: options.model,
      messages: []
    }
    this.store.update((draft) => {
      draft.conversations.unshift(conversation)
    })
    return structuredClone(conversation)
  }

  /** Replaces a conversation (used by the chat orchestrator when a turn completes). */
  save(conversation: Conversation): Conversation {
    const updated: Conversation = { ...conversation, updatedAt: new Date().toISOString() }
    this.store.update((draft) => {
      const index = draft.conversations.findIndex((item) => item.id === updated.id)
      if (index >= 0) draft.conversations[index] = updated
      else draft.conversations.unshift(updated)
    })
    return structuredClone(updated)
  }

  rename(id: string, title: string): ConversationSummary | null {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120)
    let result: ConversationSummary | null = null
    this.store.update((draft) => {
      const conversation = draft.conversations.find((item) => item.id === id)
      if (!conversation) return
      conversation.title = clean || conversation.title
      result = summarize(conversation)
    })
    return result
  }

  remove(id: string): boolean {
    let removed = false
    this.store.update((draft) => {
      const before = draft.conversations.length
      draft.conversations = draft.conversations.filter((item) => item.id !== id)
      removed = draft.conversations.length !== before
    })
    return removed
  }

  removeAll(): number {
    const count = this.store.get().conversations.length
    this.store.update((draft) => {
      draft.conversations = []
    })
    return count
  }

  search(query: string): ReturnType<typeof searchConversations> {
    return searchConversations(this.store.get().conversations, query)
  }

  /** Adds conversations from an exported file; ids are regenerated on collision. */
  import(rawList: unknown[]): number {
    const existingIds = new Set(this.store.get().conversations.map((item) => item.id))
    const incoming: Conversation[] = []
    for (const raw of rawList) {
      const conversation = normalizeConversation(raw)
      if (!conversation) continue
      if (existingIds.has(conversation.id)) {
        conversation.id = newId()
        conversation.messages = conversation.messages.map((message) => ({ ...message, id: newId() }))
        conversation.title = `${conversation.title} (imported)`
      }
      existingIds.add(conversation.id)
      incoming.push(conversation)
    }
    if (incoming.length) {
      this.store.update((draft) => {
        draft.conversations = [...incoming, ...draft.conversations]
      })
    }
    return incoming.length
  }

  async stats(): Promise<DataStats> {
    const conversations = this.store.get().conversations
    const oldest = conversations.reduce<string | null>((acc, conversation) => {
      if (!acc) return conversation.createdAt
      return Date.parse(conversation.createdAt) < Date.parse(acc) ? conversation.createdAt : acc
    }, null)
    return {
      conversations: conversations.length,
      messages: conversations.reduce((total, conversation) => total + conversation.messages.length, 0),
      databaseBytes: await this.store.sizeBytes(),
      databasePath: this.store.path,
      oldest
    }
  }
}
