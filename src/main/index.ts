import { BrowserWindow, app, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { StreamDeltaEvent, StreamDoneEvent, StreamErrorEvent } from '@shared/types'
import { GeminiService } from './gemini/service'
import { registerIpcHandlers } from './ipc'
import { log } from './logger'
import { buildApplicationMenu } from './menu'
import { ConversationRepository } from './store/conversations'
import { SecretStore } from './store/secrets'
import { SettingsRepository } from './store/settings'
import { WindowStateStore } from './windowState'

// The product name drives the userData folder, so it is set before Electron
// resolves any path.
app.setName('GPTN')

let mainWindow: BrowserWindow | null = null
let conversations: ConversationRepository
let settings: SettingsRepository
let secrets: SecretStore
let windowState: WindowStateStore
let service: GeminiService

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow(): BrowserWindow {
  const bounds = windowState.current(screen.getAllDisplays())
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === 'number' ? { x: bounds.x } : {}),
    ...(typeof bounds.y === 'number' ? { y: bounds.y } : {}),
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'GPTN',
    // Native macOS look: traffic lights inside a unified, translucent title bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // The renderer stays fully sandboxed; all privileged work happens over IPC.
      webSecurity: true
    }
  })

  if (bounds.maximized) window.maximize()

  window.once('ready-to-show', () => {
    window.show()
    if (!app.isPackaged) window.webContents.openDevTools({ mode: 'detach' })
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Keep the webview pinned to the app: external links always open in the browser.
  window.webContents.on('will-navigate', (event, url) => {
    const isDevServer =
      !!process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL']!)
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  windowState.track(window)
  return window
}

/** Creates the stores and services once Electron is ready. */
async function bootstrap(): Promise<void> {
  log.init()

  const userDataPath = app.getPath('userData')
  conversations = new ConversationRepository(join(userDataPath, 'conversations.json'))
  settings = new SettingsRepository(join(userDataPath, 'settings.json'))
  secrets = new SecretStore(userDataPath)
  windowState = new WindowStateStore(join(userDataPath, 'window-state.json'))

  await Promise.all([conversations.load(), settings.load(), windowState.load()])
  log.info(
    'boot',
    `GPTN ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}/${process.arch}`,
    `data: ${userDataPath}`
  )

  nativeTheme.themeSource = settings.get().theme

  service = new GeminiService({
    secrets,
    conversations,
    settings,
    emitter: {
      delta: (event: StreamDeltaEvent) => send(IPC.chat.delta, event),
      done: (event: StreamDoneEvent) => send(IPC.chat.done, event),
      error: (event: StreamErrorEvent) => send(IPC.chat.error, event)
    }
  })

  registerIpcHandlers({
    conversations,
    settings,
    secrets,
    service,
    getMainWindow: () => mainWindow,
    userDataPath,
    appVersion: app.getVersion()
  })

  buildApplicationMenu({
    getMainWindow: () => mainWindow,
    openSettings: () => send(IPC.app.navigate, 'ui:settings'),
    newChat: () => send(IPC.app.navigate, 'ui:new-chat')
  })

  mainWindow = createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app
    .whenReady()
    .then(async () => {
      await bootstrap()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
        else mainWindow?.show()
      })
    })
    .catch((error: unknown) => {
      log.error('boot', error instanceof Error ? error.message : String(error))
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    service?.stopAll()
    // Make sure the last messages are on disk before the process exits.
    void Promise.allSettled([conversations?.flush(), settings?.flush(), windowState?.flush()])
  })
}
