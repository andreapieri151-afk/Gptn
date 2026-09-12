// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/platform/api', async () => {
  const { createFakePlatform, registerFakePlatform } = await import('../helpers/fakePlatform')
  const platform = createFakePlatform()
  registerFakePlatform(platform)
  return { api: platform.api, isDesktop: true }
})

import { installBridge } from '@renderer/platform/chatBridge'
import { useChatStore } from '@renderer/state/store'
import { getFakePlatform } from '../helpers/fakePlatform'

const platform = getFakePlatform()
let uninstall: (() => void) | null = null

const wait = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function resetStore(): void {
  useChatStore.setState({
    ready: false,
    appInfo: null,
    settings: null,
    secrets: null,
    models: [],
    conversations: [],
    activeId: null,
    messages: [],
    requestId: null,
    streamingMessageId: null,
    generatingSince: null,
    lastError: null,
    settingsOpen: false,
    paletteOpen: false,
    sidebarCollapsed: false,
    toasts: []
  })
}

beforeEach(async () => {
  platform.reset()
  resetStore()
  uninstall = installBridge()
  await useChatStore.getState().bootstrap()
})

afterEach(() => {
  uninstall?.()
  uninstall = null
})

describe('renderer store', () => {
  it('bootstraps with settings, models and a fresh conversation', () => {
    const state = useChatStore.getState()
    expect(state.ready).toBe(true)
    expect(state.activeId).not.toBeNull()
    expect(state.messages).toHaveLength(0)
    expect(state.models.length).toBeGreaterThan(0)
    expect(state.activeModel).toBe('gemini-2.5-flash')
  })

  it('optimistically adds the user turn and streams the answer into the last bubble', async () => {
    await useChatStore.getState().sendMessage('Explain SSE briefly')

    const afterSend = useChatStore.getState()
    expect(afterSend.messages).toHaveLength(2)
    expect(afterSend.messages[0]).toMatchObject({ role: 'user', content: 'Explain SSE briefly' })
    expect(afterSend.messages[1]).toMatchObject({ role: 'assistant', state: 'streaming' })
    expect(afterSend.requestId).not.toBeNull()
    // The IPC request carries the whole history and the selected model.
    expect(platform.requests).toHaveLength(1)
    expect(platform.requests[0].model).toBe('gemini-2.5-flash')
    expect(platform.requests[0].messages).toHaveLength(2)
    // The sidebar title updates immediately, without waiting for the API.
    expect(useChatStore.getState().conversations[0].title).toBe('Explain SSE briefly')

    const requestId = afterSend.requestId as string
    platform.emitDelta({ requestId, text: 'Server-Sent ' })
    platform.emitDelta({ requestId, text: 'Events are…' })
    await wait()

    expect(useChatStore.getState().messages[1].content).toBe('Server-Sent Events are…')

    platform.emitDone({
      requestId,
      conversationId: platform.requests[0].conversationId,
      text: 'Server-Sent Events are…',
      model: 'gemini-2.5-flash',
      durationMs: 900,
      interrupted: false,
      usage: { promptTokens: 10, outputTokens: 20, totalTokens: 30 }
    })
    await wait()

    const settled = useChatStore.getState()
    expect(settled.requestId).toBeNull()
    expect(settled.messages[1]).toMatchObject({ state: 'complete', content: 'Server-Sent Events are…' })
    expect(settled.messages[1].usage?.totalTokens).toBe(30)
  })

  it('keeps the partial answer when generation is stopped', async () => {
    await useChatStore.getState().sendMessage('Write a long essay')
    const requestId = useChatStore.getState().requestId as string

    await useChatStore.getState().stopGeneration()
    expect(platform.stopped).toEqual([requestId])

    platform.emitDelta({ requestId, text: 'Half an answer' })
    platform.emitDone({
      requestId,
      conversationId: platform.requests[0].conversationId,
      text: 'Half an answer',
      model: 'gemini-2.5-flash',
      durationMs: 300,
      interrupted: true
    })
    await wait()

    const state = useChatStore.getState()
    expect(state.messages[1]).toMatchObject({ state: 'interrupted', content: 'Half an answer' })
    expect(state.lastError).toBeNull()
  })

  it('removes the empty assistant turn and surfaces the missing API key', async () => {
    await useChatStore.getState().sendMessage('Hello')
    const requestId = useChatStore.getState().requestId as string

    platform.emitError({
      requestId,
      conversationId: platform.requests[0].conversationId,
      error: {
        code: 'NO_API_KEY',
        title: 'No API key configured',
        message: 'Add your Google Gemini API key to start chatting with GPTN.',
        retryable: false
      }
    })
    await wait()

    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
    expect(state.lastError?.code).toBe('NO_API_KEY')
  })

  it('keeps the partial text and marks the turn as failed on API errors', async () => {
    await useChatStore.getState().sendMessage('Hello')
    const requestId = useChatStore.getState().requestId as string

    platform.emitError({
      requestId,
      conversationId: platform.requests[0].conversationId,
      error: {
        code: 'RATE_LIMIT',
        title: 'Too many requests',
        message: 'Gemini is receiving too many requests right now. Try again in a moment.',
        retryable: true
      },
      partialText: 'I was saying…'
    })
    await wait()

    const state = useChatStore.getState()
    expect(state.messages[1]).toMatchObject({ state: 'error', content: 'I was saying…' })
    expect(state.messages[1].error?.retryable).toBe(true)
  })

  it('warns when the answer was cut short by the token limit', async () => {
    await useChatStore.getState().sendMessage('Tell me everything')
    const requestId = useChatStore.getState().requestId as string

    platform.emitDone({
      requestId,
      conversationId: platform.requests[0].conversationId,
      text: 'A truncated…',
      model: 'gemini-2.5-flash',
      durationMs: 400,
      interrupted: false,
      finishReason: 'MAX_TOKENS'
    })
    await wait()

    const state = useChatStore.getState()
    expect(state.messages[1].state).toBe('complete')
    expect(state.lastError?.code).toBe('MAX_TOKENS')
  })

  it('retries the last prompt after a failure', async () => {
    await useChatStore.getState().sendMessage('Retry me')
    const requestId = useChatStore.getState().requestId as string
    platform.emitError({
      requestId,
      conversationId: platform.requests[0].conversationId,
      error: { code: 'NETWORK', title: 'Connection problem', message: 'offline', retryable: true }
    })
    await wait()

    await useChatStore.getState().retryLast()
    expect(platform.requests).toHaveLength(2)
    const retried = platform.requests[1].messages
    expect(retried.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(retried[0].content).toBe('Retry me')
  })

  it('creates a new chat, renames and deletes conversations', async () => {
    await useChatStore.getState().sendMessage('First chat')
    const firstId = useChatStore.getState().activeId as string

    await useChatStore.getState().renameConversation(firstId, 'Renamed chat')
    expect(useChatStore.getState().conversations[0].title).toBe('Renamed chat')

    await useChatStore.getState().newChat()
    expect(useChatStore.getState().activeId).not.toBe(firstId)
    expect(useChatStore.getState().messages).toHaveLength(0)

    await useChatStore.getState().deleteConversation(useChatStore.getState().activeId as string)
    expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([firstId])
    expect(useChatStore.getState().activeId).not.toBeNull()
  })

  it('reacts to native menu commands', async () => {
    const before = useChatStore.getState().activeId
    platform.emitCommand('ui:new-chat')
    await wait()
    expect(useChatStore.getState().activeId).not.toBe(before)

    platform.emitCommand('ui:settings')
    expect(useChatStore.getState().settingsOpen).toBe(true)
    expect(useChatStore.getState().settingsSection).toBe('general')

    platform.emitCommand('ui:toggle-sidebar')
    expect(useChatStore.getState().sidebarCollapsed).toBe(true)
    await wait()
    expect(platform.settings.sidebarCollapsed).toBe(true)
  })

  it('saves settings through the bridge', async () => {
    await useChatStore.getState().updateSettings({ theme: 'dark', showTokenUsage: true })
    expect(useChatStore.getState().settings?.theme).toBe('dark')
    expect(platform.settings.theme).toBe('dark')
    expect(platform.settings.showTokenUsage).toBe(true)
  })
})
