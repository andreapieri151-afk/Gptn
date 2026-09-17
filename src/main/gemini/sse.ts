/**
 * Server-Sent Events parsing for the Gemini streaming endpoints.
 * Kept free of network/Electron code so it can be tested in isolation.
 */

export interface SseEvent {
  /** `event:` field when present (Gemini does not use it, other gateways do). */
  event?: string
  /** Concatenated `data:` payload of a single event block. */
  data: string
}

/**
 * Extracts complete SSE events from a buffer.
 * Returns the events plus the unfinished remainder that must be kept for the next chunk.
 */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  let index = 0

  for (;;) {
    const match = findEventSeparator(buffer, index)
    if (!match) break
    const block = buffer.slice(index, match.start)
    index = match.end
    const event = parseBlock(block)
    if (event) events.push(event)
  }

  return { events, rest: buffer.slice(index) }
}

function findEventSeparator(buffer: string, from: number): { start: number; end: number } | null {
  const lf = buffer.indexOf('\n\n', from)
  const crlf = buffer.indexOf('\r\n\r\n', from)
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
    return { start: crlf, end: crlf + 4 }
  }
  return { start: lf, end: lf + 2 }
}

function parseBlock(block: string): SseEvent | null {
  const dataLines: string[] = []
  let event: string | undefined

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimStart()
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') event = value
  }

  if (!dataLines.length) return null
  const data = dataLines.join('\n')
  return event ? { event, data } : { data }
}

/**
 * Accumulates text and reasoning parts of a Gemini `GenerateContentResponse` stream.
 * Returns the incremental text for this chunk (and the thought summary when present).
 */
export interface ResponsePartDelta {
  text: string
  thought: string
  finishReason?: string
  blockReason?: string
  usage?: { promptTokens?: number; outputTokens?: number; totalTokens?: number }
}

export function extractStreamDelta(payload: unknown): ResponsePartDelta {
  const result: ResponsePartDelta = { text: '', thought: '' }
  if (!payload || typeof payload !== 'object') return result
  const response = payload as Record<string, unknown>

  const feedback = response.promptFeedback as { blockReason?: string } | undefined
  if (feedback?.blockReason) result.blockReason = feedback.blockReason

  const usage = response.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined
  if (usage) {
    result.usage = {
      ...(typeof usage.promptTokenCount === 'number' ? { promptTokens: usage.promptTokenCount } : {}),
      ...(typeof usage.candidatesTokenCount === 'number' ? { outputTokens: usage.candidatesTokenCount } : {}),
      ...(typeof usage.totalTokenCount === 'number' ? { totalTokens: usage.totalTokenCount } : {})
    }
  }

  const candidates = response.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>
    | undefined
  const candidate = candidates?.[0]
  if (!candidate) return result
  if (candidate.finishReason) result.finishReason = candidate.finishReason

  for (const part of candidate.content?.parts ?? []) {
    if (typeof part?.text !== 'string') continue
    if (part.thought) result.thought += part.text
    else result.text += part.text
  }
  return result
}
