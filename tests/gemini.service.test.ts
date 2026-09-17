import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GeminiService } from '@main/gemini/service'
import { ConversationRepository } from '@main/store/conversations'
import { SettingsRepository } from '@main/store/settings'
import type { GeminiTransport } from '@main/gemini/transport'
import { AppError, ErrorCode } from '@shared/errors'
import type { ChatMessage, StreamDeltaEvent, StreamDoneEvent, StreamErrorEvent } from '@shared/types'
import { fakeSecrets } from './helpers/fakeSecrets'

function message(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `${role}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    state: role === 'assistant' ? 'streaming' : 'complete'
  }
}

interface Harness {
  service: GeminiService
  conversations: ConversationRepository
  settings: SettingsRepository
  events: {
    deltas: StreamDeltaEvent[]
    done: StreamDoneEvent[]
    errors: StreamErrorEvent[]
  }
  calls: { stream: number; single: number }
  /** API keys handed to the transport, in order. */
  keys: string[]
  secrets: ReturnType<typeof fakeSecrets>
  cleanup: () => Promise<void>
}

async function createHarness(
  streamGenerate: GeminiTransport['streamGenerate'],
  apiKey: string | null = 'test-key'
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'gptn-service-'))
  const conversations = new ConversationRepository(join(dir, 'conversations.json'))
  const settings = new SettingsRepository(join(dir, 'settings.json'))
  await Promise.all([conversations.load(), settings.load()])

  const events = { deltas: [] as StreamDeltaEvent[], done: [] as StreamDoneEvent[], errors: [] as StreamErrorEvent[] }
  const calls = { stream: 0, single: 0 }
  const keys: string[] = []
  const transport = {
    streamGenerate: (...args: Parameters<GeminiTransport['streamGenerate']>) => {
      calls.stream += 1
      return streamGenerate(...args)
    },
    generate: async (params: { apiKey: string }) => {
      calls.single += 1
      keys.push(params.apiKey)
      return { text: 'A complete non-streamed answer', thought: '' }
    },
    listModels: async () => [{ id: 'gemini-test', label: 'Gemini Test', source: 'api' as const }]
  } as unknown as GeminiTransport

  const secrets = fakeSecrets(apiKey)
  const service = new GeminiService({
    secrets,
    conversations,
    settings,
    transport,
    emitter: {
      delta: (event) => events.deltas.push(event),
      done: (event) => events.done.push(event),
      error: (event) => events.errors.push(event)
    }
  })

  return {
    service,
    conversations,
    settings,
    events,
    calls,
    keys,
    secrets,
    cleanup: async () => {
      service.stopAll()
      await conversations.flush().catch(() => undefined)
      await settings.flush().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    }
  }
}

let harness: Harness | null = null

afterEach(async () => {
  if (harness) await harness.cleanup()
  harness = null
})

describe('GeminiService.send', () => {
  let conversationId = ''

  beforeEach(() => undefined)

  it('streams deltas, persists the answer and derives the conversation title', async () => {
    harness = await createHarness(async (_params, onChunk) => {
      for (const piece of ['Hel', 'lo ', 'world']) {
        onChunk?.({ text: piece, thought: '' })
      }
      return { text: 'Hello world', thought: '', finishReason: 'STOP', usage: { totalTokens: 12 } }
    })

    const conversation = harness.conversations.create({ model: 'gemini-test' })
    conversationId = conversation.id

    await harness.service.send({
      requestId: 'req-1',
      conversationId,
      model: 'gemini-test',
      messages: [message('user', 'Write a haiku about streaming'), message('assistant', '')]
    })

    expect(harness.events.deltas.map((delta) => delta.text).join('')).toBe('Hello world')
    expect(harness.events.errors).toHaveLength(0)
    expect(harness.events.done).toHaveLength(1)
    expect(harness.events.done[0].text).toBe('Hello world')
    expect(harness.events.done[0].interrupted).toBe(false)

    const stored = harness.conversations.get(conversationId)
    expect(stored?.title).toBe('Write a haiku about streaming')
    expect(stored?.messages).toHaveLength(2)
    expect(stored?.messages[1].state).toBe('complete')
    expect(stored?.messages[1].content).toBe('Hello world')
    expect(stored?.messages[1].usage?.totalTokens).toBe(12)
  })

  it('sends the API key requirement to the UI when no key is configured', async () => {
    harness = await createHarness(async () => ({ text: '', thought: '' }), null)
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    await harness.service.send({
      requestId: 'req-2',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'Hi'), message('assistant', '')]
    })

    expect(harness.events.errors).toHaveLength(1)
    expect(harness.events.errors[0].error.code).toBe(ErrorCode.NO_API_KEY)
    expect(harness.events.done).toHaveLength(0)
    const stored = harness.conversations.get(conversation.id)
    expect(stored?.messages[1].state).toBe('error')
  })

  it('translates provider failures into friendly errors and keeps partial text', async () => {
    harness = await createHarness(async (_params, onChunk) => {
      onChunk?.({ text: 'Partial answer', thought: '' })
      throw new AppError({
        code: ErrorCode.RATE_LIMIT,
        title: 'Too many requests',
        message: 'Gemini is receiving too many requests right now. Try again in a moment.',
        retryable: true,
        detail: '429 RESOURCE_EXHAUSTED'
      })
    })
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    await harness.service.send({
      requestId: 'req-3',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'Hello'), message('assistant', '')]
    })

    expect(harness.events.errors).toHaveLength(1)
    expect(harness.events.errors[0].error.code).toBe(ErrorCode.RATE_LIMIT)
    expect(harness.events.errors[0].error.retryable).toBe(true)
    expect(harness.events.errors[0].partialText).toBe('Partial answer')
    const stored = harness.conversations.get(conversation.id)
    expect(stored?.messages[1].state).toBe('error')
    expect(stored?.messages[1].content).toBe('Partial answer')
  })

  it('marks the answer as interrupted when the user stops generation', async () => {
    harness = await createHarness(async (params, onChunk) => {
      onChunk?.({ text: 'Half of the answer', thought: '' })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 2000)
        params.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true }
        )
      })
      return { text: 'Half of the answer', thought: '' }
    })
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    const sendPromise = harness.service.send({
      requestId: 'req-4',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'Tell me a long story'), message('assistant', '')]
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(harness.service.stop('req-4')).toBe(true)
    await sendPromise

    expect(harness.events.done).toHaveLength(1)
    expect(harness.events.done[0].interrupted).toBe(true)
    expect(harness.events.errors).toHaveLength(0)
    const stored = harness.conversations.get(conversation.id)
    expect(stored?.messages[1].state).toBe('interrupted')
    expect(stored?.messages[1].content).toBe('Half of the answer')
  })

  it('reports an empty answer as a retryable error', async () => {
    harness = await createHarness(async () => ({ text: '', thought: '', finishReason: 'OTHER' }))
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    await harness.service.send({
      requestId: 'req-5',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'Hello?'), message('assistant', '')]
    })

    expect(harness.events.errors[0].error.code).toBe(ErrorCode.EMPTY_RESPONSE)
    expect(harness.events.errors[0].error.retryable).toBe(true)
  })
})

describe('GeminiService model list', () => {
  it('falls back to the curated list when no key is configured', async () => {
    harness = await createHarness(async () => ({ text: '', thought: '' }), null)
    const models = await harness.service.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((model) => model.source === 'builtin')).toBe(true)
  })

  it('puts curated models first and appends API models', async () => {
    harness = await createHarness(async () => ({ text: '', thought: '' }))
    const models = await harness.service.listModels()
    expect(models[0].source).toBe('builtin')
    expect(models.some((model) => model.id === 'gemini-test')).toBe(true)
  })
})

describe('GeminiService request shaping', () => {
  it('uses the non-streaming endpoint when streaming is disabled in Settings', async () => {
    harness = await createHarness(async () => ({ text: 'streamed', thought: '' }))
    harness.settings.update({ streaming: false })
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    await harness.service.send({
      requestId: 'req-single',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'One shot please'), message('assistant', '')]
    })

    expect(harness.calls.stream).toBe(0)
    expect(harness.calls.single).toBe(1)
    // The whole answer still arrives as a single delta, so the UI code is identical.
    expect(harness.events.deltas.map((delta) => delta.text).join('')).toBe('A complete non-streamed answer')
    expect(harness.events.done[0].text).toBe('A complete non-streamed answer')
    expect(harness.conversations.get(conversation.id)?.messages[1].state).toBe('complete')
  })

  it('never overwrites an earlier answer when the history ends with a user message', async () => {
    harness = await createHarness(async (_params, onChunk) => {
      onChunk?.({ text: 'New answer', thought: '' })
      return { text: 'New answer', thought: '' }
    })
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    const previous: ChatMessage = {
      id: 'assistant-previous',
      role: 'assistant',
      content: 'The first answer must survive',
      createdAt: new Date().toISOString(),
      state: 'complete'
    }
    const followUp = message('user', 'Second question')

    await harness.service.send({
      requestId: 'req-follow-up',
      conversationId: conversation.id,
      model: 'gemini-test',
      // No placeholder at the end: exactly what a retry sends.
      messages: [message('user', 'First question'), previous, followUp]
    })

    const stored = harness.conversations.get(conversation.id)
    expect(stored?.messages.map((item) => item.content)).toEqual([
      'First question',
      'The first answer must survive',
      'Second question',
      'New answer'
    ])
    expect(stored?.messages[1].state).toBe('complete')
  })

  it('appends a placeholder when no streaming turn is open', async () => {
    harness = await createHarness(async (_params, onChunk) => {
      onChunk?.({ text: 'Answer', thought: '' })
      return { text: 'Answer', thought: '' }
    })
    const conversation = harness.conversations.create({ model: 'gemini-test' })

    await harness.service.send({
      requestId: 'req-append',
      conversationId: conversation.id,
      model: 'gemini-test',
      messages: [message('user', 'Only a user message')]
    })

    const stored = harness.conversations.get(conversation.id)
    expect(stored?.messages).toHaveLength(2)
    expect(stored?.messages[1]).toMatchObject({ role: 'assistant', content: 'Answer', state: 'complete' })
  })
})

describe('key verification before storage (first-run onboarding)', () => {
  it('checks a pasted key without writing it to the Keychain', async () => {
    harness = await createHarness(async () => ({ text: 'GPTN ready', thought: '' }), null)

    const result = await harness.service.testKey('gemini-test', '  AIzaPastedKey  ')

    expect(result.ok).toBe(true)
    expect(result.model).toBe('gemini-test')
    expect(harness.keys).toEqual(['AIzaPastedKey'])
    // Nothing was persisted: the key is only stored once it has been proven.
    expect((await harness.secrets.status()).hasApiKey).toBe(false)
    expect(await harness.secrets.getApiKey()).toBeNull()
  })

  it('still needs a stored key when no override is passed', async () => {
    harness = await createHarness(async () => ({ text: 'GPTN ready', thought: '' }), null)

    await expect(harness.service.testKey('gemini-test')).rejects.toMatchObject({
      code: ErrorCode.NO_API_KEY
    })
    expect(harness.keys).toEqual([])
  })
})
