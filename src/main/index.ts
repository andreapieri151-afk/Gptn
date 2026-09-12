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

app.setName('GPTN')

const userDataPath = app.getPath('userData')
const conversations = new ConversationRepository(join(userDataPath, 'conversations.json'))
const settings = new SettingsRepository(join(userDataPath, 'settings.json'))
const secrets = new SecretStore(userDataPath)
const windowState = new WindowStateStore(join(userDataPath, 'window-state.json'))

let mainWindow: BrowserWindow | null = null
let isQuitting = false

const service = new GeminiService({
  secrets,
  conversations,
  settings,
  emitter: {
    delta: (event: StreamDeltaEvent) => send(IPC.chat.delta, event),
    done: (event: StreamDoneEvent) => send(IPC.chat.done, event),
    error: (event: StreamErrorEvent) => send(IPC.chat.error, event)
  }
})

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
      // Renderer stays fully sandboxed; all privileged work happens over IPC.
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
    const isDevServer = !!process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL']!)
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

async function bootstrap(): Promise<void> {
  log.init()
  await Promise.all([conversations.load(), settings.load(), windowState.load()])
  log.info('boot', `GPTN ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}`)

  const current = settings.get()
  nativeTheme.themeSource = current.theme

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    else mainWindow?.show()
  })
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

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    log.error('boot', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    service.stopAll()
    // Make sure the last messages are on disk before the process exits.
    void Promise.allSettled([conversations.flush(), settings.flush()])
  })

  app.on('will-quit', () => {
    log.info('quit', 'shutting down', { isQuitting })
  })
}
