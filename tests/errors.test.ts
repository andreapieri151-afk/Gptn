import { describe, expect, it } from 'vitest'
import { ErrorCode, fromHttpStatus, fromThrown } from '@shared/errors'

describe('fromHttpStatus', () => {
  it('maps 400 to an actionable settings error', () => {
    const error = fromHttpStatus(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.')
    expect(error.code).toBe(ErrorCode.INVALID_REQUEST)
    expect(error.title).toBe('Something went wrong')
    expect(error.settingsHint).toBe(true)
    // The raw API wording is kept for the debug disclosure, not for the headline.
    expect(error.toMessageError().detail).toContain('INVALID_ARGUMENT')
  })

  it('maps 401/403 to a key problem', () => {
    expect(fromHttpStatus(401, 'UNAUTHENTICATED', 'API key not valid').code).toBe(ErrorCode.INVALID_API_KEY)
    expect(fromHttpStatus(403, 'PERMISSION_DENIED', 'Caller does not have permission').code).toBe(
      ErrorCode.PERMISSION_DENIED
    )
  })

  it('maps 404 to a missing model', () => {
    const error = fromHttpStatus(404, 'NOT_FOUND', 'models/gemini-9 does not exist', 'gemini-9')
    expect(error.code).toBe(ErrorCode.MODEL_NOT_FOUND)
    expect(error.userMessage).toContain('gemini-9')
  })

  it('distinguishes rate limits from exhausted quota', () => {
    expect(fromHttpStatus(429, 'RESOURCE_EXHAUSTED', 'Too many requests').code).toBe(ErrorCode.RATE_LIMIT)
    expect(fromHttpStatus(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota').code).toBe(
      ErrorCode.QUOTA_EXCEEDED
    )
  })

  it('maps server errors and marks them retryable', () => {
    const error = fromHttpStatus(503, 'UNAVAILABLE', 'Service unavailable')
    expect(error.code).toBe(ErrorCode.SERVER)
    expect(error.retryable).toBe(true)
  })
})

describe('fromThrown', () => {
  it('recognises aborts', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(fromThrown(abort).code).toBe(ErrorCode.ABORTED)
  })

  it('recognises DNS and connection failures from undici', () => {
    const error = new Error('fetch failed')
    ;(error as Error & { cause?: { code: string } }).cause = { code: 'ENOTFOUND' }
    const mapped = fromThrown(error)
    expect(mapped.code).toBe(ErrorCode.NETWORK)
    expect(mapped.userMessage).toContain('internet connection')
  })

  it('passes AppError instances through unchanged', () => {
    const original = fromHttpStatus(429, 'RESOURCE_EXHAUSTED', 'slow down')
    expect(fromThrown(original)).toBe(original)
  })
})
