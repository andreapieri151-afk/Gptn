import { AppError, ErrorCode, errorTitle, fromHttpStatus, fromThrown } from '@shared/errors'
import type { ModelInfo, TokenUsage } from '@shared/types'
import { extractStreamDelta, parseSseBuffer } from './sse'

export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000
export const DEFAULT_TOTAL_TIMEOUT_MS = 10 * 60_000

const HARM_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT'
] as const

export interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

export interface GenerationOptions {
  temperature?: number
  topP?: number | null
  maxOutputTokens?: number | null
  systemInstruction?: string
  /** When true the default safety thresholds are replaced with BLOCK_NONE. */
  safetyOff?: boolean
  /** Thinking budget for 2.5 models (0 disables thinking). */
  thinkingBudget?: number
}

export interface GenerateParams {
  apiKey: string
  model: string
  contents: GeminiContent[]
  generation?: GenerationOptions
  signal: AbortSignal
  baseUrl?: string
  idleTimeoutMs?: number
  totalTimeoutMs?: number
}

export interface StreamChunk {
  text: string
  thought: string
  finishReason?: string
}

export interface GenerateResult {
  text: string
  thought: string
  finishReason?: string
  usage?: TokenUsage
  blockedReason?: string
}

interface TransportOptions {
  fetchImpl?: typeof fetch
  /** Injectable in tests; defaults to the public Gemini endpoint. */
  baseUrl?: string
}

function buildGenerationConfig(options: GenerationOptions | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  if (!options) return config
  if (typeof options.temperature === 'number' && options.temperature >= 0) config.temperature = options.temperature
  if (typeof options.topP === 'number' && options.topP > 0) config.topP = options.topP
  if (typeof options.maxOutputTokens === 'number' && options.maxOutputTokens > 0) {
    config.maxOutputTokens = Math.floor(options.maxOutputTokens)
  }
  if (typeof options.thinkingBudget === 'number') {
    config.thinkingConfig = { thinkingBudget: options.thinkingBudget }
  }
  return config
}

function buildRequestInit(params: GenerateParams): { url: string; init: RequestInit } {
  const base = (params.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse`
  const body: Record<string, unknown> = {
    contents: params.contents,
    generationConfig: buildGenerationConfig(params.generation)
  }
  if (params.generation?.systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: params.generation.systemInstruction.trim() }] }
  }
  if (params.generation?.safetyOff) {
    body.safetySettings = HARM_CATEGORIES.map((category) => ({ category, threshold: 'BLOCK_NONE' }))
  }
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.apiKey
      },
      body: JSON.stringify(body)
    }
  }
}

/** Reads the error body of a failed response and maps it to a friendly AppError. */
async function toHttpError(response: Response, model: string): Promise<AppError> {
  let apiStatus: string | undefined
  let apiMessage: string | undefined
  let raw = ''
  try {
    raw = await response.text()
    const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string; code?: number } }
    apiStatus = parsed.error?.status
    apiMessage = parsed.error?.message
  } catch {
    apiMessage = raw.slice(0, 400) || response.statusText
  }
  return fromHttpStatus(response.status, apiStatus, apiMessage, model)
}

/**
 * Thin, well-tested layer over the Gemini REST endpoints.
 * All network concerns (timeouts, SSE framing, error mapping) live here so that
 * GeminiService can stay focused on conversation semantics.
 */
export class GeminiTransport {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl?: string

  constructor(options: TransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = options.baseUrl
  }

  private startRequest(
    params: GenerateParams,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ): {
    controller: AbortController
    timedOut: () => boolean
    clean: () => void
    touch: () => void
  } {
    const controller = new AbortController()
    let timedOut = false
    let idleTimer: NodeJS.Timeout | null = null
    let totalTimer: NodeJS.Timeout | null = null

    const abortWithTimeout = (): void => {
      timedOut = true
      controller.abort(new Error('gptn:timeout'))
    }
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(abortWithTimeout, idleTimeoutMs)
    }
    armIdle()
    totalTimer = setTimeout(abortWithTimeout, totalTimeoutMs)

    const onExternalAbort = (): void => controller.abort(params.signal.reason ?? new Error('aborted'))
    if (params.signal.aborted) onExternalAbort()
    else params.signal.addEventListener('abort', onExternalAbort, { once: true })

    return {
      controller,
      timedOut: () => timedOut,
      clean: () => {
        if (idleTimer) clearTimeout(idleTimer)
        if (totalTimer) clearTimeout(totalTimer)
        idleTimer = null
        totalTimer = null
        params.signal.removeEventListener('abort', onExternalAbort)
      },
      touch: armIdle
    }
  }

  /** Streams a response, invoking `onChunk` for every incremental piece of text. */
  async streamGenerate(params: GenerateParams, onChunk?: (chunk: StreamChunk) => void): Promise<GenerateResult> {
    const request = buildRequestInit({ ...params, baseUrl: params.baseUrl || this.baseUrl })
    const { controller, timedOut, clean, touch } = this.startRequest(
      params,
      params.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      params.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS
    )

    let text = ''
    let thought = ''
    let usage: TokenUsage | undefined
    let finishReason: string | undefined
    let blockedReason: string | undefined

    try {
      const response = await this.fetchImpl(request.url, { ...request.init, signal: controller.signal })
      if (!response.ok) throw await toHttpError(response, params.model)
      if (!response.body) {
        throw new AppError({
          code: ErrorCode.SERVER,
          title: errorTitle(ErrorCode.SERVER),
          message: 'Gemini returned an empty stream. Try again.',
          retryable: true
        })
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const consume = (chunk: string): void => {
        if (!chunk) return
        text += chunk
        onChunk?.({ text: chunk, thought: '', ...(finishReason ? { finishReason } : {}) })
      }
      const consumeThought = (chunk: string): void => {
        if (!chunk) return
        thought += chunk
        onChunk?.({ text: '', thought: chunk })
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        touch()
        buffer += decoder.decode(value, { stream: true })

        const { events, rest } = parseSseBuffer(buffer)
        buffer = rest

        for (const event of events) {
          if (event.data === '[DONE]') continue
          let payload: unknown
          try {
            payload = JSON.parse(event.data)
          } catch {
            continue
          }
          const errorPayload = (payload as { error?: { code?: number; status?: string; message?: string } }).error
          if (errorPayload) {
            throw fromHttpStatus(errorPayload.code ?? 500, errorPayload.status, errorPayload.message, params.model)
          }
          const delta = extractStreamDelta(payload)
          if (delta.blockReason) blockedReason = delta.blockReason
          if (delta.finishReason) finishReason = delta.finishReason
          if (delta.usage) usage = { ...usage, ...delta.usage }
          consumeThought(delta.thought)
          consume(delta.text)
        }
      }

      // A stream may end without a trailing separator: flush what is left.
      if (buffer.trim()) {
        const { events } = parseSseBuffer(`${buffer}\n\n`)
        for (const event of events) {
          if (event.data === '[DONE]') continue
          try {
            const delta = extractStreamDelta(JSON.parse(event.data))
            if (delta.blockReason) blockedReason = delta.blockReason
            if (delta.finishReason) finishReason = delta.finishReason
            if (delta.usage) usage = { ...usage, ...delta.usage }
            consumeThought(delta.thought)
            consume(delta.text)
          } catch {
            /* ignore malformed trailing payloads */
          }
        }
      }

      return {
        text,
        thought,
        ...(finishReason ? { finishReason } : {}),
        ...(usage ? { usage } : {}),
        ...(blockedReason ? { blockedReason } : {})
      }
    } catch (error) {
      if (timedOut()) {
        throw new AppError({
          code: ErrorCode.TIMEOUT,
          title: errorTitle(ErrorCode.TIMEOUT),
          message: 'Gemini took too long to answer. Check your connection and try again.',
          detail: 'The request exceeded the idle timeout while streaming.',
          retryable: true
        })
      }
      if (params.signal.aborted) {
        throw new AppError({
          code: ErrorCode.ABORTED,
          title: errorTitle(ErrorCode.ABORTED),
          message: 'Generation stopped.',
          retryable: true
        })
      }
      throw fromThrown(error)
    } finally {
      clean()
    }
  }

  /** Non-streaming variant, used by Settings → “Test connection”. */
  async generate(params: GenerateParams): Promise<GenerateResult> {
    const base = (params.baseUrl || this.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const url = `${base}/models/${encodeURIComponent(params.model)}:generateContent`
    const body: Record<string, unknown> = {
      contents: params.contents,
      generationConfig: buildGenerationConfig(params.generation)
    }
    if (params.generation?.systemInstruction?.trim()) {
      body.systemInstruction = { parts: [{ text: params.generation.systemInstruction.trim() }] }
    }
    const { controller, timedOut, clean } = this.startRequest(params, 20_000, 60_000)
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': params.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!response.ok) throw await toHttpError(response, params.model)
      const payload = (await response.json()) as unknown
      const errorPayload = (payload as { error?: { code?: number; status?: string; message?: string } }).error
      if (errorPayload) {
        throw fromHttpStatus(errorPayload.code ?? 500, errorPayload.status, errorPayload.message, params.model)
      }
      const delta = extractStreamDelta(payload)
      return {
        text: delta.text,
        thought: delta.thought,
        ...(delta.finishReason ? { finishReason: delta.finishReason } : {}),
        ...(delta.usage ? { usage: delta.usage } : {}),
        ...(delta.blockReason ? { blockedReason: delta.blockReason } : {})
      }
    } catch (error) {
      if (timedOut()) {
        throw new AppError({
          code: ErrorCode.TIMEOUT,
          title: errorTitle(ErrorCode.TIMEOUT),
          message: 'Gemini did not answer in time. Try again.',
          retryable: true
        })
      }
      throw fromThrown(error)
    } finally {
      clean()
    }
  }

  /** Lists the models the API key can actually use. */
  async listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
    const base = (baseUrl || this.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('gptn:timeout')), 20_000)
    try {
      const response = await this.fetchImpl(`${base}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal
      })
      if (!response.ok) throw await toHttpError(response, 'models')
      const payload = (await response.json()) as {
        models?: Array<{
          name?: string
          displayName?: string
          description?: string
          inputTokenLimit?: number
          outputTokenLimit?: number
          supportedGenerationMethods?: string[]
        }>
      }
      return (payload.models ?? [])
        .filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
        .filter((model) => !!model.name)
        .map((model) => {
          const id = (model.name as string).replace(/^models\//, '')
          const info: ModelInfo = {
            id,
            label: model.displayName?.trim() || id,
            source: 'api' as const
          }
          if (model.description) info.description = model.description
          if (typeof model.inputTokenLimit === 'number') info.inputTokenLimit = model.inputTokenLimit
          if (typeof model.outputTokenLimit === 'number') info.outputTokenLimit = model.outputTokenLimit
          return info
        })
        .sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) {
      throw fromThrown(error)
    } finally {
      clearTimeout(timer)
    }
  }
}
