import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { AppInfo, ChatRequest, ConversationsChangedReason, ExportRequest, Settings } from '@shared/types'
import { AppError, ErrorCode, fromThrown, storageError } from '@shared/errors'
import { fileNameFor, conversationsToJson, conversationsToMarkdown, writeExport } from './exporter'
import type { GeminiService } from './gemini/service'
import { log } from './logger'
import type { ConversationRepository } from './store/conversations'
import type { SecretStore } from './store/secrets'
import type { SettingsRepository } from './store/settings'

export interface IpcContext {
  conversations: ConversationRepository
  settings: SettingsRepository
  secrets: SecretStore
  service: GeminiService
  getMainWindow: () => BrowserWindow | null
  userDataPath: string
  appVersion: string
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function conversationsChanged(reason: ConversationsChangedReason): void {
  broadcast(IPC.conversations.changed, { reason })
}

function applyTheme(settings: Settings): void {
  nativeTheme.themeSource = settings.theme
}

function toAppInfo(version: string, userDataPath: string): AppInfo {
  return {
    name: app.getName(),
    version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath,
    isDev: !app.isPackaged
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  const { conversations, settings, secrets, service } = context

  ipcMain.handle(IPC.app.info, () => toAppInfo(context.appVersion, context.userDataPath))

  ipcMain.handle(IPC.app.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string') return
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return
    await shell.openExternal(url)
  })

  // ---------------------------------------------------------------- settings
  ipcMain.handle(IPC.settings.get, () => settings.get())

  ipcMain.handle(IPC.settings.update, (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return settings.get()
    const before = settings.get()
    const updated = settings.update(patch as Partial<Settings>)
    if (updated.theme !== before.theme) applyTheme(updated)
    if (updated.model !== before.model || updated.baseUrl !== before.baseUrl) service.invalidateModelCache()
    broadcast(IPC.settings.changed, updated)
    return updated
  })

  // ----------------------------------------------------------------- secrets
  ipcMain.handle(IPC.secrets.status, () => secrets.status())

  ipcMain.handle(IPC.secrets.setApiKey, async (_event, key: unknown) => {
    if (typeof key !== 'string') {
      throw new AppError({
        code: ErrorCode.INVALID_REQUEST,
        title: 'Invalid API key',
        message: 'The API key must be a text value.',
        retryable: false
      })
    }
    await secrets.setApiKey(key)
    service.invalidateModelCache()
    log.info('secrets', key.trim() ? 'API key updated' : 'API key cleared')
    return secrets.status()
  })

  ipcMain.handle(IPC.secrets.clearApiKey, async () => {
    await secrets.clearApiKey()
    service.invalidateModelCache()
    return secrets.status()
  })

  ipcMain.handle(IPC.secrets.test, async (_event, model: unknown, key: unknown) => {
    const started = Date.now()
    try {
      // `key` is optional: the onboarding checks a pasted key before storing it.
      const result = await service.testKey(
        typeof model === 'string' ? model : undefined,
        typeof key === 'string' && key.trim() ? key.trim() : undefined
      )
      log.info('secrets', `key test ok with ${result.model} in ${result.latencyMs}ms`)
      return result
    } catch (error) {
      const friendly = fromThrown(error)
      log.warn('secrets', `key test failed: ${friendly.code}`)
      return { ok: false, error: friendly.toMessageError(), latencyMs: Date.now() - started }
    }
  })

  ipcMain.handle(IPC.models.list, (_event, force: unknown) => service.listModels(force === true))

  // ----------------------------------------------------------- conversations
  ipcMain.handle(IPC.conversations.list, () => conversations.list())

  ipcMain.handle(IPC.conversations.get, (_event, id: unknown) =>
    typeof id === 'string' ? conversations.get(id) : null
  )

  ipcMain.handle(IPC.conversations.create, (_event, options: unknown) => {
    const value = (options ?? {}) as { model?: string; title?: string }
    const model = value.model?.trim() || settings.get().model
    const conversation = conversations.create({ model, ...(value.title ? { title: value.title } : {}) })
    conversationsChanged('created')
    return conversation
  })

  ipcMain.handle(IPC.conversations.rename, (_event, id: unknown, title: unknown) => {
    if (typeof id !== 'string' || typeof title !== 'string') return null
    const result = conversations.rename(id, title)
    if (result) conversationsChanged('renamed')
    return result
  })

  ipcMain.handle(IPC.conversations.remove, (_event, id: unknown) => {
    if (typeof id !== 'string') return
    if (conversations.remove(id)) conversationsChanged('deleted')
  })

  ipcMain.handle(IPC.conversations.removeAll, () => {
    const count = conversations.removeAll()
    conversationsChanged('deleted-all')
    return count
  })

  ipcMain.handle(IPC.conversations.search, (_event, query: unknown) =>
    typeof query === 'string' ? conversations.search(query) : []
  )

  // -------------------------------------------------------------------- chat
  ipcMain.handle(IPC.chat.start, (event: IpcMainInvokeEvent, request: unknown) => {
    if (!request || typeof request !== 'object') return
    const parsed = request as Partial<ChatRequest>
    if (
      typeof parsed.requestId !== 'string' ||
      typeof parsed.conversationId !== 'string' ||
      !Array.isArray(parsed.messages)
    ) {
      throw new AppError({
        code: ErrorCode.INVALID_REQUEST,
        title: 'Invalid request',
        message: 'GPTN could not send this message. Try again.',
        retryable: true
      })
    }
    const fullRequest: ChatRequest = {
      requestId: parsed.requestId,
      conversationId: parsed.conversationId,
      messages: parsed.messages,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : settings.get().model
    }

    const sender = event.sender

    // Generation runs detached: the renderer follows it through stream events.
    void service
      .send(fullRequest)
      .then(() => conversationsChanged('updated'))
      .catch((error: unknown) => {
        const friendly = fromThrown(error)
        log.error('chat', `unhandled failure: ${friendly.code}`, friendly.message)
        if (!sender.isDestroyed()) {
          sender.send(IPC.chat.error, {
            requestId: fullRequest.requestId,
            conversationId: fullRequest.conversationId,
            error: friendly.toMessageError()
          })
        }
      })
    return undefined
  })

  ipcMain.handle(IPC.chat.stop, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return false
    return service.stop(requestId)
  })

  // -------------------------------------------------------------------- data
  ipcMain.handle(IPC.data.stats, () => conversations.stats())

  ipcMain.handle(IPC.data.revealFolder, async () => {
    await shell.openPath(context.userDataPath)
  })

  ipcMain.handle(IPC.data.export, async (_event, request: unknown) => {
    const parsed = (request ?? {}) as ExportRequest
    const format = parsed.format === 'json' ? 'json' : 'markdown'
    const ids = Array.isArray(parsed.conversationIds) ? parsed.conversationIds : []
    const all = conversations.list()
    const targets = ids.length ? ids : all.map((summary) => summary.id)
    const selected = targets
      .map((id) => conversations.get(id))
      .filter((conversation): conversation is NonNullable<typeof conversation> => conversation !== null)
    if (!selected.length) return { canceled: true, count: 0 }

    const extension = format === 'json' ? 'json' : 'md'
    let targetPath = parsed.targetPath
    if (!targetPath) {
      const window = context.getMainWindow()
      const defaultName =
        selected.length === 1 ? fileNameFor(selected[0].title, extension) : `gptn-export.${extension}`
      const options = {
        title: 'Export conversations',
        defaultPath: join(app.getPath('downloads'), defaultName),
        filters:
          format === 'json'
            ? [{ name: 'JSON', extensions: ['json'] }]
            : [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { canceled: true, count: 0 }
      targetPath = result.filePath
    }

    const content =
      format === 'json'
        ? conversationsToJson(selected, context.appVersion)
        : conversationsToMarkdown(selected, context.appVersion)
    try {
      await conversations.flush()
      await writeExport(targetPath, content)
    } catch (error) {
      throw storageError((error as Error).message)
    }
    log.info('export', `${selected.length} conversation(s) → ${targetPath}`)
    return { canceled: false, path: targetPath, count: selected.length }
  })

  ipcMain.handle(IPC.data.import, async () => {
    const window = context.getMainWindow()
    const options = {
      title: 'Import conversations',
      filters: [{ name: 'GPTN export', extensions: ['json'] }],
      properties: ['openFile' as const]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return { canceled: true, imported: 0 }
    try {
      const raw = await readFile(result.filePaths[0], 'utf8')
      const parsed = JSON.parse(raw) as { conversations?: unknown[] } | unknown[]
      const list = Array.isArray(parsed) ? parsed : (parsed.conversations ?? [])
      const imported = conversations.import(Array.isArray(list) ? list : [])
      if (imported > 0) conversationsChanged('imported')
      return { canceled: false, imported }
    } catch (error) {
      throw new AppError({
        code: ErrorCode.STORAGE,
        title: 'Import failed',
        message: 'This file is not a valid GPTN export.',
        detail: (error as Error).message,
        retryable: false
      })
    }
  })

}
