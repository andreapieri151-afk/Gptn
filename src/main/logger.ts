import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

type Level = 'info' | 'warn' | 'error'

const lines: string[] = []
const MAX_MEMORY_LINES = 400
let filePath: string | null = null
let ready = false

function timestamp(): string {
  return new Date().toISOString()
}

function format(level: Level, scope: string, args: unknown[]): string {
  const parts = args.map((value) => {
    if (typeof value === 'string') return value
    if (value instanceof Error) return `${value.name}: ${value.message}`
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  })
  return `[${timestamp()}] ${level.toUpperCase()} ${scope} — ${parts.join(' ')}`
}

async function persist(line: string): Promise<void> {
  if (!filePath) return
  try {
    await mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
    await appendFile(filePath, `${line}\n`, 'utf8')
  } catch {
    /* logging must never break the app */
  }
}

function write(level: Level, scope: string, args: unknown[]): void {
  const line = format(level, scope, args)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  lines.push(line)
  if (lines.length > MAX_MEMORY_LINES) lines.shift()
  if (ready) void persist(line)
}

export const log = {
  /** Initialises file logging inside the app's userData folder. */
  init(): void {
    filePath = join(app.getPath('userData'), 'logs', 'gptn.log')
    ready = true
  },
  info: (scope: string, ...args: unknown[]): void => write('info', scope, args),
  warn: (scope: string, ...args: unknown[]): void => write('warn', scope, args),
  error: (scope: string, ...args: unknown[]): void => write('error', scope, args),
  /** Recent log lines, shown in Settings → About → Diagnostics. */
  recent: (limit = 120): string[] => lines.slice(-limit),
  filePath: (): string | null => filePath
}
