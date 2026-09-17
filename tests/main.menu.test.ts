import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

/**
 * The menu bar is the only place where the native shortcuts are declared, so it
 * gets its own test: a missing accelerator would be a silent regression.
 */
const setApplicationMenu = vi.fn()
const openExternal = vi.fn()
const showItemInFolder = vi.fn()

vi.mock('electron', () => ({
  app: { name: 'GPTN', getVersion: () => '1.0.0' },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  shell: { openExternal, showItemInFolder },
  Menu: {
    setApplicationMenu,
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => template
  }
}))

// The app ships for macOS: exercise the Darwin menu template.
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

const send = vi.fn()
const openSettings = vi.fn()
const newChat = vi.fn()

const { buildApplicationMenu } = await import('@main/menu')

function template(): MenuItemConstructorOptions[] {
  buildApplicationMenu({
    getMainWindow: () => ({ webContents: { send } }) as unknown as BrowserWindow,
    openSettings,
    newChat
  })
  return setApplicationMenu.mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[]
}

function findItem(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined {
  for (const item of items) {
    if (item.label === label) return item
    if (Array.isArray(item.submenu)) {
      const nested = findItem(item.submenu, label)
      if (nested) return nested
    }
  }
  return undefined
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  setApplicationMenu.mockClear()
  send.mockClear()
  openSettings.mockClear()
  newChat.mockClear()
})

describe('application menu', () => {
  it('exposes the standard top level menus, including the app menu', () => {
    const items = template()
    // macOS app menu: About / Settings… / Hide / Quit
    const appMenu = items[0].submenu as MenuItemConstructorOptions[]
    const labels = appMenu.map((item) => item.label ?? item.role)
    expect(labels).toContain('About GPTN')
    expect(labels).toContain('Settings…')
    expect(labels).toContain('quit')
  })

  it('exposes the standard top level menus', () => {
    const items = template()
    const labels = items.map((item) => item.label ?? item.role)
    expect(labels).toContain('File')
    expect(labels).toContain('Edit')
    expect(labels).toContain('View')
    expect(labels).toContain('Window')
    expect(labels).toContain('help')
  })

  it('wires the GPTN shortcuts to the right actions', () => {
    const items = template()

    const newChatItem = findItem(items, 'New Chat')
    expect(newChatItem?.accelerator).toBe('CmdOrCtrl+N')
    newChatItem?.click?.(undefined as never, undefined as never, undefined as never)
    expect(newChat).toHaveBeenCalledTimes(1)

    const settings = findItem(items, 'Settings…')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    settings?.click?.(undefined as never, undefined as never, undefined as never)
    expect(openSettings).toHaveBeenCalledTimes(1)

    const search = findItem(items, 'Search Chats…')
    expect(search?.accelerator).toBe('CmdOrCtrl+K')
    search?.click?.(undefined as never, undefined as never, undefined as never)
    expect(send).toHaveBeenCalledWith('app:navigate', 'ui:search')

    const sidebar = findItem(items, 'Toggle Sidebar')
    sidebar?.click?.(undefined as never, undefined as never, undefined as never)
    expect(send).toHaveBeenCalledWith('app:navigate', 'ui:toggle-sidebar')

    const copyLast = findItem(items, 'Copy Last Answer')
    expect(copyLast?.accelerator).toBe('CmdOrCtrl+Shift+C')
    copyLast?.click?.(undefined as never, undefined as never, undefined as never)
    expect(send).toHaveBeenCalledWith('app:navigate', 'ui:copy-last-answer')
  })

  it('keeps native roles for editing and window management', () => {
    const items = template()
    const editSubmenu = items.find((item) => item.label === 'Edit')?.submenu as MenuItemConstructorOptions[]
    const roles = editSubmenu.map((item) => item.role).filter(Boolean)
    expect(roles).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']))

    const windowSubmenu = items.find((item) => item.label === 'Window')?.submenu as MenuItemConstructorOptions[]
    const windowRoles = windowSubmenu.map((item) => item.role).filter(Boolean)
    expect(windowRoles).toEqual(expect.arrayContaining(['minimize', 'zoom']))
  })

  it('links the help menu to the Gemini documentation', () => {
    const items = template()
    const help = findItem(items, 'Gemini API Documentation')
    help?.click?.(undefined as never, undefined as never, undefined as never)
    expect(openExternal).toHaveBeenCalledWith('https://ai.google.dev/gemini-api/docs')
  })
})
