import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GeminiTransport } from '@main/gemini/transport'
import { ErrorCode } from '@shared/errors'

/**
 * These tests run the real transport against a local HTTP server that speaks the
 * Gemini streaming protocol, so SSE framing, timeouts, error mapping and
 * cancellation are all exercised without touching the network.
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void

let server: Server
let baseUrl: string
let handler: Handler

beforeAll(async () => {
  server = createServer((request, response) => {
    handler(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not start')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function sseChunk(text: string, finish?: string): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, ...(finish ? { finishReason: finish } : {}) }]
  })}\n\n`
}

function streamOf(response: ServerResponse, chunks: string[], delayMs = 0): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  let index = 0
  const write = (): void => {
    if (index >= chunks.length) {
      response.end()
      return
    }
    response.write(chunks[index])
    index += 1
    setTimeout(write, delayMs)
  }
  write()
}

const request = {
  apiKey: 'test-key',
  model: 'gemini-test',
  contents: [{ role: 'user' as const, parts: [{ text: 'Hi' }] }],
  signal: new AbortController().signal
}

describe('GeminiTransport.streamGenerate', () => {
  it('streams incremental text and totals it', async () => {
    handler = (_request, response) => {
      // Deliberately split a JSON payload across two writes.
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('data: {"candidates":[{"content":{"parts":[{"text":"Hel')
      setTimeout(() => {
        response.write('lo"}]},"finishReason":"STOP"}]}\n\n')
        response.end()
      }, 5)
    }

    const deltas: string[] = []
    const result = await new GeminiTransport({ baseUrl }).streamGenerate(request, (chunk) => {
      if (chunk.text) deltas.push(chunk.text)
    })

    expect(deltas.join('')).toBe('Hello')
    expect(result.text).toBe('Hello')
    expect(result.finishReason).toBe('STOP')
  })

  it('sends the API key in the x-goog-api-key header and the model in the path', async () => {
    let seenUrl = ''
    let seenKey: string | undefined
    handler = (incoming, response) => {
      seenUrl = incoming.url ?? ''
      seenKey = incoming.headers['x-goog-api-key'] as string
      streamOf(response, [sseChunk('ok')])
    }

    await new GeminiTransport({ baseUrl }).streamGenerate(request)
    expect(seenUrl).toContain('/models/gemini-test:streamGenerateContent')
    expect(seenUrl).toContain('alt=sse')
    expect(seenKey).toBe('test-key')
  })

  it('includes system instructions, generation config and safety settings', async () => {
    let body: Record<string, unknown> = {}
    handler = (incoming, response) => {
      let raw = ''
      incoming.on('data', (chunk) => {
        raw += chunk
      })
      incoming.on('end', () => {
        body = JSON.parse(raw)
        streamOf(response, [sseChunk('ok')])
      })
    }

    await new GeminiTransport({ baseUrl }).streamGenerate({
      ...request,
      generation: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 512,
        systemInstruction: 'Be concise',
        safetyOff: true
      }
    })

    expect(body.generationConfig).toEqual({ temperature: 0.4, topP: 0.9, maxOutputTokens: 512 })
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be concise' }] })
    expect(Array.isArray(body.safetySettings)).toBe(true)
  })

  it('maps HTTP 429 to a retryable rate-limit error', async () => {
    handler = (_request, response) => {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' } }))
    }

    await expect(new GeminiTransport({ baseUrl }).streamGenerate(request)).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMIT,
      retryable: true
    })
  })

  it('maps HTTP 400 to the friendly "Something went wrong" copy', async () => {
    handler = (_request, response) => {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad request' } }))
    }

    await expect(new GeminiTransport({ baseUrl }).streamGenerate(request)).rejects.toMatchObject({
      code: ErrorCode.INVALID_REQUEST,
      title: 'Something went wrong',
      settingsHint: true
    })
  })

  it('surfaces an error object received mid-stream', async () => {
    handler = (_request, response) => {
      streamOf(response, [
        sseChunk('partial'),
        `data: ${JSON.stringify({ error: { code: 500, status: 'INTERNAL', message: 'boom' } })}\n\n`
      ])
    }

    await expect(new GeminiTransport({ baseUrl }).streamGenerate(request)).rejects.toMatchObject({
      code: ErrorCode.SERVER
    })
  })

  it('stops when the caller aborts and reports ABORTED', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(sseChunk('first'))
      // keep the connection open
    }

    const controller = new AbortController()
    const promise = new GeminiTransport({ baseUrl }).streamGenerate({ ...request, signal: controller.signal })
    setTimeout(() => controller.abort(new Error('user stopped')), 30)
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.ABORTED })
  })

  it('times out when the stream stalls', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(': ping\n\n')
      // never sends data again
    }

    await expect(
      new GeminiTransport({ baseUrl }).streamGenerate({ ...request, idleTimeoutMs: 120 })
    ).rejects.toMatchObject({ code: ErrorCode.TIMEOUT, retryable: true })
  })

  it('reports network failures in plain language', async () => {
    const transport = new GeminiTransport({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetch })
    await expect(transport.streamGenerate(request)).rejects.toMatchObject({ code: ErrorCode.NETWORK })
  })
})

describe('GeminiTransport.listModels', () => {
  it('keeps only models that support generateContent', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] }
          ]
        })
      )
    }

    const models = await new GeminiTransport({ baseUrl }).listModels('test-key')
    expect(models.map((model) => model.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
    expect(models[0].label).toBe('Gemini 2.5 Flash')
    expect(models[0].source).toBe('api')
  })
})
