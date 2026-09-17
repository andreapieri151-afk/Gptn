import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, Settings } from '@shared/types'

/**
 * Exercises the real IPC handlers with a mocked Electron layer: channel names,
 * payload validation, persistence and the export pipeline. This is the glue the
 * preload bridge talks to, so a mistake here would break the whole app.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const broadcasts: Array<{ channel: string; payload: unknown }> = []
const saveDialog = vi.fn()
const themeSource = { value: 'system' }

vi.mock('electron', () => ({
  app: {
    getName: () => 'GPTN',
    getVersion: () => '1.0.0',
    getPath: (name: string) => (name === 'downloads' ? '/tmp' : '/tmp/gptn-userdata'),
    isPackaged: false
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  },
  nativeTheme: {
    get themeSource() {
      return themeSource.value
    },
    set themeSource(value: string) {
      themeSource.value = value
    }
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => saveDialog(...args),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showMessageBox: vi.fn(async () => ({ response: 1 }))
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  clipboard: { writeText: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  },
  BrowserWindow: {
    getAllWindows: () => [] as unknown[],
    fromWebContents: () => null
  }
}))

const { registerIpcHandlers } = await import('@main/ipc')
const { ConversationRepository } = await import('@main/store/conversations')
const { SettingsRepository } = await import('@main/store/settings')
const { IPC } = await import('@shared/ipc')
const { fakeSecrets } = await import('./helpers/fakeSecrets')

let dir: string
let conversations: InstanceType<typeof ConversationRepository>
let settings: InstanceType<typeof SettingsRepository>
let serviceSend: ReturnType<typeof vi.fn>
/** [model, key] pairs forwarded to the service by the key-test handler. */
const testedKeys: Array<[string | undefined, string | undefined]> = []
let serviceStop: ReturnType<typeof vi.fn>

/**
 * Calls a registered handler the way ipcRenderer.invoke would: a synchronous
 * throw inside the handler still reaches the renderer as a rejected promise.
 */
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  try {
    return Promise.resolve(handler({ sender: { id: 1, isDestroyed: () => false, send: () => undefined } }, ...args))
  } catch (error) {
    return Promise.reject(error)
  }
}

beforeEach(async () => {
  handlers.clear()
  broadcasts.length = 0
  saveDialog.mockReset()
  themeSource.value = 'system'

  dir = await mkdtemp(join(tmpdir(), 'gptn-ipc-'))
  conversations = new ConversationRepository(join(dir, 'conversations.json'))
  settings = new SettingsRepository(join(dir, 'settings.json'))
  await Promise.all([conversations.load(), settings.load()])

  serviceSend = vi.fn(async () => undefined)
  serviceStop = vi.fn(() => true)

  registerIpcHandlers({
    conversations,
    settings,
    secrets: fakeSecrets('AIzaSyTestKey1234') as never,
    service: {
      send: serviceSend,
      stop: serviceStop,
      listModels: async () => [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'builtin' }],
      testKey: async (model?: string, key?: string) => {
        testedKeys.push([model, key])
        return { ok: true, model: model ?? 'gemini-2.5-flash', latencyMs: 42, models: [] }
      },
      invalidateModelCache: () => undefined
    } as never,
    getMainWindow: () => null,
    userDataPath: dir,
    appVersion: '1.0.0'
  })
})

afterEach(async () => {
  await conversations.flush().catch(() => undefined)
  await settings.flush().catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

describe('IPC: app + settings', () => {
  it('exposes application metadata', async () => {
    const info = (await invoke(IPC.app.info)) as { name: string; version: string; platform: string }
    expect(info.name).toBe('GPTN')
    expect(info.version).toBe('1.0.0')
    expect(info.platform).toBe(process.platform)
  })

  it('reads and updates settings, applying the theme to macOS', async () => {
    const initial = (await invoke(IPC.settings.get)) as Settings
    expect(initial.theme).toBe('system')
    expect(initial.model).toBe('gemini-2.5-flash')

    const updated = (await invoke(IPC.settings.update, { theme: 'dark', temperature: 1.4 })) as Settings
    expect(updated.theme).toBe('dark')
    expect(updated.temperature).toBe(1.4)
    expect(themeSource.value).toBe('dark')
    expect(settings.get().theme).toBe('dark')

    // Out-of-range values are repaired instead of being stored.
    const clamped = (await invoke(IPC.settings.update, { temperature: 99, sidebarWidth: 9999 })) as Settings
    expect(clamped.temperature).toBe(2)
    expect(clamped.sidebarWidth).toBe(460)
  })

  it('ignores malformed settings payloads', async () => {
    const before = settings.get()
    await invoke(IPC.settings.update, 'not-an-object')
    expect(settings.get()).toEqual(before)
  })
})

describe('IPC: conversations', () => {
  it('creates, lists, renames and deletes conversations', async () => {
    const created = (await invoke(IPC.conversations.create, { model: 'gemini-2.5-flash' })) as { id: string }
    expect(created.id).toBeTruthy()

    const list = (await invoke(IPC.conversations.list)) as Array<{ id: string; title: string }>
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('New chat')

    const renamed = (await invoke(IPC.conversations.rename, created.id, '  Renamed via IPC ')) as { title: string }
    expect(renamed.title).toBe('Renamed via IPC')

    const fetched = (await invoke(IPC.conversations.get, created.id)) as { title: string }
    expect(fetched.title).toBe('Renamed via IPC')

    await invoke(IPC.conversations.remove, created.id)
    expect(await invoke(IPC.conversations.list)).toEqual([])
    expect(await invoke(IPC.conversations.removeAll)).toBe(0)
  })

  it('searches stored conversations', async () => {
    const created = (await invoke(IPC.conversations.create, { title: 'Kubernetes notes' })) as { id: string }
    const hits = (await invoke(IPC.conversations.search, 'kubernetes')) as Array<{ conversationId: string }>
    expect(hits[0]?.conversationId).toBe(created.id)
    expect(await invoke(IPC.conversations.search, 42)).toEqual([])
  })

  it('reports database statistics', async () => {
    await invoke(IPC.conversations.create, {})
    const stats = (await invoke(IPC.data.stats)) as { conversations: number; databasePath: string }
    expect(stats.conversations).toBe(1)
    expect(stats.databasePath).toContain('conversations.json')
  })
})

describe('IPC: secrets', () => {
  it('stores, masks and clears the API key', async () => {
    const status = (await invoke(IPC.secrets.status)) as { hasApiKey: boolean; maskedKey: string | null }
    expect(status.hasApiKey).toBe(true)
    expect(status.maskedKey).toMatch(/^AIza.*1234$/)
    expect(status.maskedKey).not.toContain('TestKey')
  })

  it('rejects a non-string key', async () => {
    await expect(invoke(IPC.secrets.setApiKey, 42)).rejects.toThrow()
  })

  it('reports a successful connection test', async () => {
    const result = (await invoke(IPC.secrets.test)) as { ok: boolean; latencyMs: number }
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBe(42)
    expect(testedKeys.at(-1)).toEqual([undefined, undefined])
  })

  it('forwards a key to verify without storing it (first-run onboarding)', async () => {
    const result = (await invoke(IPC.secrets.test, 'gemini-2.5-flash', '  AIzaPastedKey  ')) as {
      ok: boolean
    }
    expect(result.ok).toBe(true)
    // The key is trimmed and handed over as-is: the handler never stores it.
    expect(testedKeys.at(-1)).toEqual(['gemini-2.5-flash', 'AIzaPastedKey'])
    expect((await invoke(IPC.secrets.status)) as { hasApiKey: boolean }).toMatchObject({ hasApiKey: true })
  })

  it('ignores a key argument that is not a usable string', async () => {
    await invoke(IPC.secrets.test, undefined, '   ')
    expect(testedKeys.at(-1)).toEqual([undefined, undefined])
    await invoke(IPC.secrets.test, undefined, 42)
    expect(testedKeys.at(-1)).toEqual([undefined, undefined])
  })
})

describe('IPC: chat', () => {
  it('validates the request before touching the network', async () => {
    await expect(invoke(IPC.chat.start, { requestId: 'x' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(invoke(IPC.chat.start, null)).resolves.toBeUndefined()
    expect(serviceSend).not.toHaveBeenCalled()
  })

  it('starts a generation and forwards it to the service', async () => {
    const request: ChatRequest = {
      requestId: 'req-1',
      conversationId: 'c1',
      model: '',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', createdAt: new Date().toISOString(), state: 'complete' }
      ]
    }
    await invoke(IPC.chat.start, request)
    await vi.waitFor(() => expect(serviceSend).toHaveBeenCalledTimes(1))
    // An empty model falls back to the configured default.
    expect(serviceSend.mock.calls[0][0]).toMatchObject({ model: 'gemini-2.5-flash', requestId: 'req-1' })

    expect(await invoke(IPC.chat.stop, 'req-1')).toBe(true)
    expect(serviceStop).toHaveBeenCalledWith('req-1')
    expect(await invoke(IPC.chat.stop, 7)).toBe(false)
  })
})

describe('IPC: export and import', () => {
  it('writes a Markdown export to the requested path', async () => {
    const created = (await invoke(IPC.conversations.create, { title: 'Exportable' })) as { id: string }
    conversations.save({
      ...conversations.get(created.id)!,
      messages: [
        { id: 'm1', role: 'user', content: 'Ping', createdAt: new Date().toISOString(), state: 'complete' }
      ]
    })

    const target = join(dir, 'export.md')
    const result = (await invoke(IPC.data.export, {
      format: 'markdown',
      conversationIds: [created.id],
      targetPath: target
    })) as { canceled: boolean; path: string; count: number }

    expect(result).toMatchObject({ canceled: false, count: 1, path: target })
    const written = await readFile(target, 'utf8')
    expect(written).toContain('# GPTN export')
    expect(written).toContain('## Exportable')
    expect(written).toContain('Ping')
  })

  it('writes a JSON export that contains the conversations', async () => {
    await invoke(IPC.conversations.create, { title: 'Json export' })
    const target = join(dir, 'export.json')
    await invoke(IPC.data.export, { format: 'json', conversationIds: [], targetPath: target })

    const payload = JSON.parse(await readFile(target, 'utf8')) as { app: string; conversations: unknown[] }
    expect(payload.app).toBe('GPTN')
    expect(payload.conversations).toHaveLength(1)
  })

  it('uses a native save dialog when no path is provided', async () => {
    await invoke(IPC.conversations.create, { title: 'Dialog export' })
    saveDialog.mockResolvedValueOnce({ canceled: true })
    const result = (await invoke(IPC.data.export, { format: 'markdown', conversationIds: [] })) as {
      canceled: boolean
    }
    expect(saveDialog).toHaveBeenCalledTimes(1)
    expect(result.canceled).toBe(true)
  })

  it('cancels cleanly when there is nothing to export', async () => {
    const result = (await invoke(IPC.data.export, { format: 'markdown', conversationIds: [] })) as {
      canceled: boolean
      count: number
    }
    expect(result).toEqual({ canceled: true, count: 0 })
    expect(saveDialog).not.toHaveBeenCalled()
  })
})
