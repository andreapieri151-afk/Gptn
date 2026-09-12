import type { BrowserWindow } from 'electron'
import { JsonStore } from './store/jsonStore'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

const DEFAULTS: WindowState = { width: 1180, height: 780, maximized: false }
const MIN_WIDTH = 760
const MIN_HEIGHT = 540

/**
 * Remembers size/position between launches — expected behaviour for a desktop app.
 * Bounds are validated against the currently connected displays so the window can
 * never be restored off-screen (e.g. after unplugging an external monitor).
 */
export class WindowStateStore {
  private readonly store: JsonStore<WindowState>

  constructor(file: string) {
    this.store = new JsonStore<WindowState>(
      file,
      () => ({ ...DEFAULTS }),
      (raw, fallback) => {
        const value = raw as Partial<WindowState>
        const state: WindowState = { ...fallback }
        if (typeof value.width === 'number') state.width = Math.max(MIN_WIDTH, Math.round(value.width))
        if (typeof value.height === 'number') state.height = Math.max(MIN_HEIGHT, Math.round(value.height))
        if (typeof value.x === 'number') state.x = Math.round(value.x)
        if (typeof value.y === 'number') state.y = Math.round(value.y)
        if (typeof value.maximized === 'boolean') state.maximized = value.maximized
        return state
      }
    )
  }

  async load(): Promise<WindowState> {
    return this.store.load()
  }

  /** Bounds suited for the current displays; falls back to defaults when off-screen. */
  current(displays: Array<{ workArea: { x: number; y: number; width: number; height: number } }>): WindowState {
    const state = this.store.get()
    const visible =
      typeof state.x === 'number' &&
      typeof state.y === 'number' &&
      displays.some((display) => {
        const area = display.workArea
        return (
          state.x! + 80 > area.x &&
          state.y! + 40 > area.y &&
          state.x! < area.x + area.width - 80 &&
          state.y! < area.y + area.height - 40
        )
      })
    return visible ? state : { width: state.width, height: state.height, maximized: state.maximized }
  }

  track(window: BrowserWindow): void {
    const save = (): void => {
      if (window.isDestroyed()) return
      const maximized = window.isMaximized()
      const bounds = maximized ? window.getNormalBounds() : window.getBounds()
      this.store.set({ ...bounds, maximized })
      void this.store.flush()
    }
    let timer: NodeJS.Timeout | null = null
    const debounced = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 400)
    }
    window.on('resize', debounced)
    window.on('move', debounced)
    window.on('maximize', debounced)
    window.on('unmaximize', debounced)
    window.on('close', () => {
      if (timer) clearTimeout(timer)
      save()
    })
  }
}
