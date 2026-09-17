import {
  Menu,
  app,
  clipboard,
  dialog,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'
import { IPC, UI_COMMAND, type UiCommand } from '@shared/ipc'
import { log } from './logger'

export interface MenuContext {
  getMainWindow(): BrowserWindow | null
  openSettings(): void
  newChat(): void
}

/**
 * Full native macOS menu bar: app menu, Edit menu (spelling, speech), View menu
 * with standard macOS accelerators plus GPTN specific shortcuts.
 */
export function buildApplicationMenu(context: MenuContext): void {
  const isMac = process.platform === 'darwin'
  const send = (command: UiCommand): void => {
    context.getMainWindow()?.webContents.send(IPC.app.navigate, command)
  }
  const showDiagnostics = async (): Promise<void> => {
    const detail = [
      `${app.name} ${app.getVersion()}`,
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
      `${process.platform} ${process.getSystemVersion?.() ?? ''} (${process.arch})`,
      `userData: ${app.getPath('userData')}`,
      '',
      '— recent log —',
      ...log.recent(40)
    ].join('\n')
    const window = context.getMainWindow()
    const options = {
      type: 'info' as const,
      title: 'GPTN Diagnostics',
      message: 'Diagnostics information',
      detail,
      buttons: ['Copy', 'Close'],
      defaultId: 1,
      cancelId: 1
    }
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response === 0) clipboard.writeText(detail)
  }

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about', label: `About ${app.name}` },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => context.openSettings() },
            { type: 'separator' },
            { role: 'services', submenu: [] },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => context.newChat() },
        { label: 'Search Chats…', accelerator: 'CmdOrCtrl+K', click: () => send(UI_COMMAND.search) },
        { type: 'separator' },
        { label: 'Export Current Chat…', click: () => send(UI_COMMAND.exportActive) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Copy Last Answer', accelerator: 'CmdOrCtrl+Shift+C', click: () => send(UI_COMMAND.copyLastAnswer) },
        { type: 'separator' },
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Ctrl+S', click: () => send(UI_COMMAND.toggleSidebar) },
        { label: 'Focus Message Field', accelerator: 'CmdOrCtrl+L', click: () => send(UI_COMMAND.focusComposer) },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => context.getMainWindow()?.webContents.toggleDevTools()
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ] as MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        { label: 'Get a Gemini API Key', click: () => void shell.openExternal('https://aistudio.google.com/apikey') },
        {
          label: 'Gemini API Documentation',
          click: () => void shell.openExternal('https://ai.google.dev/gemini-api/docs')
        },
        { type: 'separator' },
        { label: 'Open Logs Folder', click: () => {
          const path = log.filePath()
          if (path) void shell.showItemInFolder(path)
        } },
        { label: 'Diagnostics…', click: () => void showDiagnostics() }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
