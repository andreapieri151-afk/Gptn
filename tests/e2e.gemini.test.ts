import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { GeminiService } from '@main/gemini/service'
import { GeminiTransport } from '@main/gemini/transport'
import { ConversationRepository } from '@main/store/conversations'
import { SettingsRepository } from '@main/store/settings'
import type { ChatMessage, StreamDeltaEvent, StreamDoneEvent, StreamErrorEvent } from '@shared/types'
import { fakeSecrets } from './helpers/fakeSecrets'

/**
 * End-to-end run of the full chain used in production:
 *
 *   GeminiService → GeminiTransport → HTTP → SSE protocol → back to the UI events
 *
 * The HTTP endpoint speaks the same wire protocol as the Gemini API
 * (`streamGenerateContent?alt=sse`), so everything except Google's servers and
 * the Keychain is exercised here.
 */

let server: Server
let baseUrl = ''
let requestCount = 0
let lastApiKey: string | undefined

const ANSWER = 'Streaming from the wire works.'

beforeAll(async () => {
  server = createServer((request, response) => {
    requestCount += 1
    lastApiKey = request.headers['x-goog-api-key'] as string

    if (request.url?.includes('/models/gemini-broken')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'model not found' } }))
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const parts = ANSWER.split(' ')
    let index = 0
    const writeNext = (): void => {
      if (index >= parts.length) {
        response.write(
          `data: ${JSON.stringify({
            candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 7, totalTokenCount: 16 }
          })}\n\n`
        )
        response.end()
        return
      }
      const piece = index === 0 ? parts[index] : ` ${parts[index]}`
      response.write(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`
      )
      index += 1
      setTimeout(writeNext, 5)
    }
    writeNext()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake Gemini server failed to start')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) await cleanup()
  cleanup = null
})

function userMessage(content: string): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    state: 'complete'
  }
}

describe('GPTN ↔ Gemini end to end', () => {
  it('streams an answer, records usage and saves the conversation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gptn-e2e-'))
    const conversations = new ConversationRepository(join(dir, 'conversations.json'))
    const settings = new SettingsRepository(join(dir, 'settings.json'))
    await Promise.all([conversations.load(), settings.load()])
    settings.update({ model: 'gemini-e2e', baseUrl })

    const deltas: StreamDeltaEvent[] = []
    const done: StreamDoneEvent[] = []
    const errors: StreamErrorEvent[] = []

    const service = new GeminiService({
      secrets: fakeSecrets('AIza-test-key'),
      conversations,
      settings,
      transport: new GeminiTransport({ baseUrl }),
      emitter: {
        delta: (event) => deltas.push(event),
        done: (event) => done.push(event),
        error: (event) => errors.push(event)
      }
    })

    const conversation = conversations.create({ model: 'gemini-e2e' })
    await service.send({
      requestId: 'req-e2e',
      conversationId: conversation.id,
      model: 'gemini-e2e',
      messages: [
        userMessage('Say something about streaming'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          state: 'streaming'
        }
      ]
    })

    expect(requestCount).toBeGreaterThan(0)
    expect(lastApiKey).toBe('AIza-test-key')
    expect(errors).toHaveLength(0)
    expect(deltas.map((delta) => delta.text).join('')).toBe(ANSWER)

    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ text: ANSWER, model: 'gemini-e2e', interrupted: false })
    expect(done[0].usage?.totalTokens).toBe(16)

    const stored = conversations.get(conversation.id)
    expect(stored?.title).toBe('Say something about streaming')
    expect(stored?.messages[1]).toMatchObject({ content: ANSWER, state: 'complete' })
    expect(stored?.messages[1].usage?.promptTokens).toBe(9)

    // The answer survives a restart: read it back from disk.
    await conversations.flush()
    const reopened = new ConversationRepository(join(dir, 'conversations.json'))
    await reopened.load()
    expect(reopened.get(conversation.id)?.messages[1].content).toBe(ANSWER)

    cleanup = async () => {
      service.stopAll()
      await conversations.flush().catch(() => undefined)
      await settings.flush().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing model with the friendly Model unavailable message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gptn-e2e-'))
    const conversations = new ConversationRepository(join(dir, 'conversations.json'))
    const settings = new SettingsRepository(join(dir, 'settings.json'))
    await Promise.all([conversations.load(), settings.load()])
    settings.update({ model: 'gemini-broken', baseUrl })

    const errors: StreamErrorEvent[] = []
    const service = new GeminiService({
      secrets: fakeSecrets('AIza-test-key'),
      conversations,
      settings,
      transport: new GeminiTransport({ baseUrl }),
      emitter: { delta: () => undefined, done: () => undefined, error: (event) => errors.push(event) }
    })

    const conversation = conversations.create({ model: 'gemini-broken' })
    await service.send({
      requestId: 'req-e2e-404',
      conversationId: conversation.id,
      model: 'gemini-broken',
      messages: [
        userMessage('Hello'),
        { id: 'assistant-2', role: 'assistant', content: '', createdAt: new Date().toISOString(), state: 'streaming' }
      ]
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].error.code).toBe('MODEL_NOT_FOUND')
    expect(errors[0].error.title).toBe('Model unavailable')
    expect(errors[0].error.message).toContain('gemini-broken')

    cleanup = async () => {
      service.stopAll()
      await conversations.flush().catch(() => undefined)
      await settings.flush().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })
})
