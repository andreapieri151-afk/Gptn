import type { MessageError } from './types'

/**
 * Stable error codes shared between the AI service and the UI copy layer.
 */
export const ErrorCode = {
  NO_API_KEY: 'NO_API_KEY',
  INVALID_API_KEY: 'INVALID_API_KEY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SAFETY_BLOCKED: 'SAFETY_BLOCKED',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  SERVER: 'SERVER',
  ABORTED: 'ABORTED',
  STORAGE: 'STORAGE',
  SECRET_STORAGE_UNAVAILABLE: 'SECRET_STORAGE_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/** Error thrown inside the main process; serialised to MessageError over IPC. */
export class AppError extends Error {
  readonly code: ErrorCodeValue
  readonly title: string
  readonly userMessage: string
  readonly detail?: string
  readonly retryable: boolean
  readonly settingsHint: boolean

  constructor(options: {
    code: ErrorCodeValue
    title: string
    message: string
    detail?: string
    retryable?: boolean
    settingsHint?: boolean
  }) {
    super(options.message)
    this.name = 'AppError'
    this.code = options.code
    this.title = options.title
    this.userMessage = options.message
    if (options.detail) this.detail = options.detail
    this.retryable = options.retryable ?? false
    this.settingsHint = options.settingsHint ?? false
  }

  toMessageError(): MessageError {
    const error: MessageError = {
      code: this.code,
      title: this.title,
      message: this.userMessage,
      retryable: this.retryable
    }
    if (this.detail) error.detail = this.detail
    return error
  }
}

const titles: Record<ErrorCodeValue, string> = {
  NO_API_KEY: 'No API key configured',
  INVALID_API_KEY: 'Invalid API key',
  PERMISSION_DENIED: 'Access denied',
  MODEL_NOT_FOUND: 'Model unavailable',
  RATE_LIMIT: 'Too many requests',
  QUOTA_EXCEEDED: 'Quota reached',
  INVALID_REQUEST: 'Something went wrong',
  SAFETY_BLOCKED: 'Response blocked',
  EMPTY_RESPONSE: 'Empty response',
  TIMEOUT: 'Request timed out',
  NETWORK: 'Connection problem',
  SERVER: 'Gemini is unavailable',
  ABORTED: 'Generation stopped',
  STORAGE: 'Could not save data',
  SECRET_STORAGE_UNAVAILABLE: 'Secure storage unavailable',
  UNKNOWN: 'Something went wrong'
}

export function errorTitle(code: ErrorCodeValue): string {
  return titles[code] ?? titles.UNKNOWN
}

/**
 * Maps an HTTP response from the Gemini API to a friendly, actionable error.
 * Documented statuses: https://ai.google.dev/gemini-api/docs/troubleshooting
 */
export function fromHttpStatus(
  status: number,
  apiStatus: string | undefined,
  apiMessage: string | undefined,
  model?: string,
  apiReason?: string
): AppError {
  // The technical detail keeps Google's status, reason and message for the
  // "Technical details" disclosure (never as the headline the user sees).
  const detail = [apiStatus && `${status} ${apiStatus}`, apiReason, apiMessage].filter(Boolean).join(' — ')
  // Google reports a bad key as 400 INVALID_ARGUMENT with reason API_KEY_INVALID
  // (details[].reason), sometimes as 401/403. All of them mean "check your key".
  const keyProblem =
    /API_KEY_INVALID|API_KEY_EXPIRED/i.test(apiReason ?? '') ||
    /API key not valid|API key expired|API_KEY_INVALID|unregistered callers/i.test(apiMessage ?? '')

  if (status === 400) {
    if (keyProblem) {
      return new AppError({
        code: ErrorCode.INVALID_API_KEY,
        title: titles.INVALID_API_KEY,
        message: invalidKeyMessage(),
        detail,
        settingsHint: true,
        retryable: false
      })
    }
    return new AppError({
      code: ErrorCode.INVALID_REQUEST,
      title: titles.INVALID_REQUEST,
      message:
        'Gemini could not process this request. Check your API settings or try again with a shorter conversation.',
      detail,
      settingsHint: true,
      retryable: false
    })
  }
  if (status === 401 || status === 403) {
    if (keyProblem || status === 401) {
      return new AppError({
        code: ErrorCode.INVALID_API_KEY,
        title: titles.INVALID_API_KEY,
        message: invalidKeyMessage(),
        detail,
        settingsHint: true,
        retryable: false
      })
    }
    return new AppError({
      code: ErrorCode.PERMISSION_DENIED,
      title: titles.PERMISSION_DENIED,
      message: 'This API key is not allowed to use the selected model. Check your Google AI project.',
      detail,
      settingsHint: true,
      retryable: false
    })
  }
  if (status === 404) {
    return new AppError({
      code: ErrorCode.MODEL_NOT_FOUND,
      title: titles.MODEL_NOT_FOUND,
      message: `The model “${model ?? 'selected'}” is not available for this API key. Pick another model in Settings.`,
      detail,
      settingsHint: true,
      retryable: false
    })
  }
  if (status === 429) {
    const quota = /quota|billing|exceeded your current quota/i.test(apiMessage ?? '')
    return quota
      ? new AppError({
          code: ErrorCode.QUOTA_EXCEEDED,
          title: titles.QUOTA_EXCEEDED,
          message:
            'Your Gemini quota has been reached. Wait for the quota to reset or use a different API key.',
          detail,
          settingsHint: true,
          retryable: true
        })
      : new AppError({
          code: ErrorCode.RATE_LIMIT,
          title: titles.RATE_LIMIT,
          message: 'Gemini is receiving too many requests right now. Try again in a moment.',
          detail,
          retryable: true
        })
  }
  if (status === 408 || status === 504) {
    return new AppError({
      code: ErrorCode.TIMEOUT,
      title: titles.TIMEOUT,
      message: 'Gemini took too long to respond. Your connection may be slow — try again.',
      detail,
      retryable: true
    })
  }
  if (status >= 500) {
    return new AppError({
      code: ErrorCode.SERVER,
      title: titles.SERVER,
      message: 'Gemini returned a temporary error. Try again in a few seconds.',
      detail,
      retryable: true
    })
  }
  return new AppError({
    code: ErrorCode.UNKNOWN,
    title: titles.UNKNOWN,
    message: 'Gemini could not complete this request. Check your API settings or try again.',
    detail,
    retryable: true
  })
}

/** Maps low level network / abort failures to friendly errors. */
export function fromThrown(error: unknown): AppError {
  if (error instanceof AppError) return error
  const err = error as { name?: string; message?: string; cause?: { code?: string } } | undefined
  const message = err?.message ?? String(error)
  const code = err?.cause?.code ?? ''

  if (err?.name === 'AbortError' || /aborted/i.test(message)) {
    return new AppError({
      code: ErrorCode.ABORTED,
      title: titles.ABORTED,
      message: 'Generation stopped.',
      retryable: true
    })
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|certificate|fetch failed/i.test(
      message
    ) ||
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
  ) {
    return new AppError({
      code: ErrorCode.NETWORK,
      title: titles.NETWORK,
      message: 'GPTN could not reach Gemini. Check your internet connection and try again.',
      detail: message,
      retryable: true
    })
  }
  return new AppError({
    code: ErrorCode.UNKNOWN,
    title: titles.UNKNOWN,
    message: 'Something unexpected happened. Try again — if it keeps happening, check your API settings.',
    detail: message,
    retryable: true
  })
}

function invalidKeyMessage(): string {
  return 'Google rejected this API key. Check that it is copied in full and that the Generative Language API is enabled for its project.'
}

export function noApiKeyError(): AppError {
  return new AppError({
    code: ErrorCode.NO_API_KEY,
    title: titles.NO_API_KEY,
    message: 'Add your Google Gemini API key to start chatting with GPTN.',
    settingsHint: true,
    retryable: false
  })
}

export function storageError(detail: string): AppError {
  return new AppError({
    code: ErrorCode.STORAGE,
    title: titles.STORAGE,
    message: 'GPTN could not write to its local database. Check the available disk space.',
    detail,
    retryable: true
  })
}
