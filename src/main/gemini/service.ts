import type {
  ChatMessage,
  ChatRequest,
  Conversation,
  ModelInfo,
  StreamDeltaEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  TestKeyResult
} from '@shared/types'
import { AppError, ErrorCode, errorTitle, fromThrown, noApiKeyError } from '@shared/errors'
import { deriveTitle } from '@shared/text'
import type { ConversationRepository } from '../store/conversations'
import { newId } from '../store/conversations'
import type { SettingsRepository } from '../store/settings'
import { BUILTIN_MODELS } from '../store/settings'
import type { SecretStore } from '../store/secrets'
import { GeminiTransport, type GeminiContent } from './transport'

const SAVE_INTERVAL_MS = 1500
const MODEL_CACHE_MS = 10 * 60_000

const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'])

export interface ServiceEmitter {
  delta(event: StreamDeltaEvent): void
  done(event: StreamDoneEvent): void
  error(event: StreamErrorEvent): void
}

export interface GeminiServiceOptions {
  secrets: SecretStore
  conversations: ConversationRepository
  settings: SettingsRepository
  transport?: GeminiTransport
  emitter: ServiceEmitter
}

interface ActiveRequest {
  controller: AbortController
  conversationId: string
  assistantId: string
  model: string
}

/**
 * Owns everything about a chat turn: history mapping, streaming, cancellation,
 * persistence and error translation. The renderer only sends intents and
 * receives deltas, so no API detail leaks into the UI layer.
 */
export class GeminiService {
  private readonly secrets: SecretStore
  private readonly conversations: ConversationRepository
  private readonly settings: SettingsRepository
  private readonly transport: GeminiTransport
  private readonly emitter: ServiceEmitter
  private readonly active = new Map<string, ActiveRequest>()
  private modelCache: { at: number; models: ModelInfo[] } | null = null

  constructor(options: GeminiServiceOptions) {
    this.secrets = options.secrets
    this.conversations = options.conversations
    this.settings = options.settings
    this.transport = options.transport ?? new GeminiTransport()
    this.emitter = options.emitter
  }

  get activeCount(): number {
    return this.active.size
  }

  private async requireApiKey(): Promise<string> {
    const stored = await this.secrets.getApiKey()
    const key = stored ?? process.env.GEMINI_API_KEY?.trim() ?? ''
    if (!key) throw noApiKeyError()
    return key
  }

  /** Maps the UI history to the Gemini `contents` format. */
  private toContents(messages: ChatMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = []
    for (const message of messages) {
      const text = message.content.trim()
      if (!text) continue
      const role: GeminiContent['role'] = message.role === 'assistant' ? 'model' : 'user'
      const last = contents[contents.length - 1]
      // Gemini requires alternating roles; merge consecutive same-role turns.
      if (last && last.role === role) {
        last.parts[0].text = `${last.parts[0].text}\n\n${text}`
      } else {
        contents.push({ role, parts: [{ text }] })
      }
    }
    // A conversation must start with a user turn.
    while (contents.length && contents[0].role === 'model') contents.shift()
    return contents
  }

  async send(request: ChatRequest): Promise<void> {
    const settings = this.settings.get()
    const conversation = this.conversations.get(request.conversationId)
    if (!conversation) {
      this.emitError(request, {
        code: ErrorCode.STORAGE,
        title: errorTitle(ErrorCode.STORAGE),
        message: 'This conversation is no longer available. Start a new chat.',
        retryable: false
      })
      return
    }
    if (this.active.has(request.requestId)) return

    const target = this.prepareConversation(conversation, request)
    const contents = this.toContents(target.conversation.messages.filter((message) => message.id !== target.assistantId))

    if (!contents.length) {
      this.emitError(request, {
        code: ErrorCode.INVALID_REQUEST,
        title: errorTitle(ErrorCode.INVALID_REQUEST),
        message: 'Write a message before sending.',
        retryable: false
      })
      return
    }

    let apiKey: string
    try {
      apiKey = await this.requireApiKey()
    } catch (error) {
      const friendly = fromThrown(error)
      this.failConversation(target, request, friendly)
      return
    }

    const controller = new AbortController()
    this.active.set(request.requestId, {
      controller,
      conversationId: target.conversation.id,
      assistantId: target.assistantId,
      model: request.model
    })

    const startedAt = Date.now()
    let text = ''
    let thought = ''
    let lastSave = 0

    try {
      const params = {
        apiKey,
        model: request.model,
        contents,
        signal: controller.signal,
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
        generation: {
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxOutputTokens,
          systemInstruction: settings.systemInstruction,
          safetyOff: settings.safetyMode === 'off'
        }
      }

      const onChunk = (chunk: { text: string; thought: string }): void => {
        if (chunk.text) {
          text += chunk.text
          this.emitter.delta({ requestId: request.requestId, text: chunk.text })
        }
        if (chunk.thought) {
          thought += chunk.thought
          this.emitter.delta({ requestId: request.requestId, text: '', thought: chunk.thought })
        }
        const now = Date.now()
        if (now - lastSave > SAVE_INTERVAL_MS) {
          lastSave = now
          this.persistStreaming(target, text, thought)
        }
      }

      // Streaming can be turned off in Settings → General: then the answer is
      // requested in one shot (no SSE) and delivered as a single delta.
      const result = settings.streaming
        ? await this.transport.streamGenerate(params, onChunk)
        : await this.transport.generate(params).then((single) => {
            onChunk({ text: single.text, thought: single.thought })
            return single
          })

      const interrupted = controller.signal.aborted
      text = result.text

      if (result.blockedReason || (result.finishReason && BLOCKED_FINISH_REASONS.has(result.finishReason))) {
        const reason = result.blockedReason ?? result.finishReason ?? 'SAFETY'
        const blocked = new AppError({
          code: ErrorCode.SAFETY_BLOCKED,
          title: errorTitle(ErrorCode.SAFETY_BLOCKED),
          message: 'Gemini blocked this response for safety reasons. Try rephrasing your message.',
          detail: `Blocked with reason: ${reason}`,
          retryable: true
        })
        this.failConversation(target, request, blocked, text)
        return
      }

      if (!text.trim() && !interrupted) {
        const empty = new AppError({
          code: ErrorCode.EMPTY_RESPONSE,
          title: errorTitle(ErrorCode.EMPTY_RESPONSE),
          message: 'Gemini returned an empty answer. Try sending the message again.',
          detail: result.finishReason ? `finishReason: ${result.finishReason}` : undefined,
          retryable: true
        })
        this.failConversation(target, request, empty)
        return
      }

      target.conversation.messages = target.conversation.messages.map((message) =>
        message.id === target.assistantId
          ? {
              ...message,
              content: text,
              state: interrupted ? ('interrupted' as const) : ('complete' as const),
              model: request.model,
              ...(thought ? { thought } : {}),
              ...(result.usage ? { usage: result.usage } : {})
            }
          : message
      )
      const saved = this.conversations.save(target.conversation)
      const doneEvent: StreamDoneEvent = {
        requestId: request.requestId,
        conversationId: saved.id,
        text,
        model: request.model,
        durationMs: Date.now() - startedAt,
        interrupted,
        ...(thought ? { thought } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.finishReason ? { finishReason: result.finishReason } : {})
      }
      await this.conversations.flush().catch((error: unknown) => {
        console.warn('[gptn] could not flush conversations', (error as Error).message)
      })
      this.emitter.done(doneEvent)
    } catch (error) {
      const friendly = fromThrown(error)
      if (friendly.code === ErrorCode.ABORTED || controller.signal.aborted) {
        // Stopped by the user: keep whatever was already generated.
        target.conversation.messages = target.conversation.messages.map((message) =>
          message.id === target.assistantId
            ? { ...message, content: text, state: 'interrupted' as const, ...(thought ? { thought } : {}) }
            : message
        )
        const saved = this.conversations.save(target.conversation)
        await this.conversations.flush().catch(() => undefined)
        this.emitter.done({
          requestId: request.requestId,
          conversationId: saved.id,
          text,
          model: request.model,
          durationMs: Date.now() - startedAt,
          interrupted: true,
          ...(thought ? { thought } : {})
        })
        return
      }
      this.failConversation(target, request, friendly, text, thought)
    } finally {
      this.active.delete(request.requestId)
    }
  }

  /** Builds the conversation to persist and identifies the assistant placeholder. */
  private prepareConversation(
    stored: Conversation,
    request: ChatRequest
  ): { conversation: Conversation; assistantId: string } {
    const messages = request.messages.map((message) => ({ ...message }))
    // Only the final assistant turn can be the placeholder for this request.
    // Looking any further back would overwrite an answer already on screen
    // (for example when a retry sends a history that ends with a user message).
    const candidate = messages[messages.length - 1]
    const isPlaceholder = candidate?.role === 'assistant' && candidate.state !== 'complete'
    let assistantId: string
    if (candidate && isPlaceholder) {
      assistantId = candidate.id
      messages[messages.length - 1] = { ...candidate, content: '', state: 'streaming', model: request.model }
    } else {
      assistantId = newId()
      messages.push({
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        state: 'streaming',
        model: request.model
      })
    }

    const firstUser = messages.find((message) => message.role === 'user')
    const shouldRetitle =
      (!stored.title || stored.title === 'New chat' || stored.title.trim() === '') && !!firstUser?.content.trim()

    const conversation: Conversation = {
      ...stored,
      model: request.model,
      messages,
      title: shouldRetitle ? deriveTitle(firstUser!.content) : stored.title
    }
    return { conversation, assistantId }
  }

  private persistStreaming(target: { conversation: Conversation; assistantId: string }, text: string, thought: string): void {
    this.conversations.save({
      ...target.conversation,
      messages: target.conversation.messages.map((message) =>
        message.id === target.assistantId
          ? { ...message, content: text, state: 'streaming' as const, ...(thought ? { thought } : {}) }
          : message
      )
    })
  }

  private failConversation(
    target: { conversation: Conversation; assistantId: string },
    request: ChatRequest,
    error: AppError,
    partialText = '',
    thought = ''
  ): void {
    const messageError = error.toMessageError()
    this.conversations.save({
      ...target.conversation,
      messages: target.conversation.messages.map((message) =>
        message.id === target.assistantId
          ? {
              ...message,
              content: partialText,
              state: 'error' as const,
              error: messageError,
              ...(thought ? { thought } : {}),
              model: request.model
            }
          : message
      )
    })
    void this.conversations.flush().catch(() => undefined)
    this.emitError(request, messageError, partialText, thought)
  }

  private emitError(
    request: ChatRequest,
    error: StreamErrorEvent['error'],
    partialText = '',
    thought = ''
  ): void {
    this.emitter.error({
      requestId: request.requestId,
      conversationId: request.conversationId,
      error,
      ...(partialText ? { partialText } : {}),
      ...(thought ? { thought } : {})
    })
  }

  /** Cancels an in-flight generation, keeping the partial answer. */
  stop(requestId: string): boolean {
    const active = this.active.get(requestId)
    if (!active) return false
    active.controller.abort(new Error('stopped by user'))
    return true
  }

  stopAll(): void {
    for (const [, active] of this.active) active.controller.abort(new Error('app is quitting'))
    this.active.clear()
  }

  private builtinModels(): ModelInfo[] {
    const custom = this.settings.get().customModels.map<ModelInfo>((model) => ({
      id: model.id,
      label: model.label,
      source: 'custom'
    }))
    return [
      ...BUILTIN_MODELS.map<ModelInfo>((model) => ({ id: model.id, label: model.label, source: 'builtin' })),
      ...custom
    ]
  }

  /** Curated list, enriched with the models the API key can actually use. */
  async listModels(force = false): Promise<ModelInfo[]> {
    const fallback = this.builtinModels()
    const key = (await this.secrets.getApiKey()) ?? process.env.GEMINI_API_KEY?.trim() ?? ''
    if (!key) return fallback
    if (!force && this.modelCache && Date.now() - this.modelCache.at < MODEL_CACHE_MS) {
      return this.mergeModels(this.modelCache.models, fallback)
    }
    try {
      const models = await this.transport.listModels(key, this.settings.get().baseUrl || undefined)
      if (!models.length) return fallback
      this.modelCache = { at: Date.now(), models }
      return this.mergeModels(models, fallback)
    } catch {
      return fallback
    }
  }

  private mergeModels(remote: ModelInfo[], fallback: ModelInfo[]): ModelInfo[] {
    const seen = new Set(remote.map((model) => model.id))
    const curated = fallback.filter((model) => !seen.has(model.id))
    // Keep the curated short list first, then the remaining API models.
    return [...curated, ...remote.map((model) => ({ ...model, source: 'api' as const }))]
  }

  invalidateModelCache(): void {
    this.modelCache = null
  }

  /**
   * Settings → AI → “Test connection”: a real round trip to Gemini.
   * `keyOverride` lets the first-run screen verify a key before it is stored.
   */
  async testKey(modelOverride?: string, keyOverride?: string): Promise<TestKeyResult> {
    const apiKey = keyOverride?.trim() || (await this.requireApiKey())
    const model = modelOverride?.trim() || this.settings.get().model
    const started = Date.now()
    let models: ModelInfo[] = []
    try {
      models = await this.transport.listModels(apiKey, this.settings.get().baseUrl || undefined).catch(() => [])
    } catch {
      models = []
    }

    const attempt = async (target: string): Promise<TestKeyResult> => {
      const result = await this.transport.generate({
        apiKey,
        model: target,
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: GPTN ready' }] }],
        generation: { temperature: 0, maxOutputTokens: 32 },
        signal: new AbortController().signal
      })
      if (result.blockedReason) {
        throw new AppError({
          code: ErrorCode.SAFETY_BLOCKED,
          title: errorTitle(ErrorCode.SAFETY_BLOCKED),
          message: 'The request was blocked by Gemini safety filters.',
          retryable: true
        })
      }
      return { ok: true, model: target, latencyMs: Date.now() - started, models }
    }

    try {
      return await attempt(model)
    } catch (error) {
      const friendly = fromThrown(error)
      // A stale default model should not look like a broken key.
      if (friendly.code === ErrorCode.MODEL_NOT_FOUND && models.length) {
        try {
          return await attempt(models[0].id)
        } catch (retryError) {
          throw fromThrown(retryError)
        }
      }
      throw friendly
    }
  }
}
