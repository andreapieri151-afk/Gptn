import { describe, expect, it } from 'vitest'
import { extractStreamDelta, parseSseBuffer } from '@main/gemini/sse'

describe('parseSseBuffer', () => {
  it('parses complete events and keeps the remainder', () => {
    const { events, rest } = parseSseBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    expect(events.map((event) => event.data)).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('data: {"c"')
  })

  it('handles chunk boundaries in the middle of an event', () => {
    const first = parseSseBuffer('data: {"cand')
    expect(first.events).toHaveLength(0)
    const second = parseSseBuffer(`${first.rest}idates":[]}\n\n`)
    expect(second.events[0].data).toBe('{"candidates":[]}')
  })

  it('supports CRLF framing and ignores comments', () => {
    const { events } = parseSseBuffer(': keep-alive\r\ndata: hello\r\n\r\n')
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('joins multi-line data payloads', () => {
    const { events } = parseSseBuffer('data: line1\ndata: line2\n\n')
    expect(events[0].data).toBe('line1\nline2')
  })

  it('reads the event name when a gateway sends one', () => {
    const { events } = parseSseBuffer('event: message\ndata: {}\n\n')
    expect(events[0]).toEqual({ event: 'message', data: '{}' })
  })
})

describe('extractStreamDelta', () => {
  it('collects text parts', () => {
    const delta = extractStreamDelta({
      candidates: [{ content: { parts: [{ text: 'Hello' }, { text: ' world' }] } }]
    })
    expect(delta.text).toBe('Hello world')
  })

  it('separates reasoning parts from the answer', () => {
    const delta = extractStreamDelta({
      candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Answer' }] } }]
    })
    expect(delta.thought).toBe('thinking…')
    expect(delta.text).toBe('Answer')
  })

  it('reports finish reasons, block reasons and usage', () => {
    const delta = extractStreamDelta({
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 40, totalTokenCount: 52 },
      candidates: [{ content: { parts: [] }, finishReason: 'STOP' }]
    })
    expect(delta.finishReason).toBe('STOP')
    expect(delta.blockReason).toBe('SAFETY')
    expect(delta.usage).toEqual({ promptTokens: 12, outputTokens: 40, totalTokens: 52 })
  })

  it('is defensive about malformed payloads', () => {
    expect(extractStreamDelta(null).text).toBe('')
    expect(extractStreamDelta({ candidates: [] }).text).toBe('')
  })
})
