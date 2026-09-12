import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WindowStateStore } from '@main/windowState'

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gptn-window-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

interface FakeWindow {
  fire(event: string): void
}

/** Minimal BrowserWindow stand-in that records the registered event handlers. */
function trackWith(
  store: WindowStateStore,
  bounds: { x: number; y: number; width: number; height: number },
  maximized = false
): FakeWindow {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  store.track({
    isDestroyed: () => false,
    isMaximized: () => maximized,
    getBounds: () => bounds,
    getNormalBounds: () => bounds,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }
  } as never)
  return { fire: (event: string) => handlers.get(event)?.() }
}

/** Waits for the debounced save to be written to disk. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500))

describe('WindowStateStore', () => {
  it('uses sensible defaults on first launch', async () => {
    const store = new WindowStateStore(join(dir, 'window-state.json'))
    await store.load()
    const state = store.current([display])
    expect(state.width).toBe(1180)
    expect(state.height).toBe(780)
    expect(state.x).toBeUndefined()
  })

  it('remembers the window size and position between launches', async () => {
    const file = join(dir, 'window-state.json')
    const store = new WindowStateStore(file)
    await store.load()

    const window = trackWith(store, { x: 120, y: 80, width: 1400, height: 900 })
    window.fire('resize')
    await settle()

    const reloaded = new WindowStateStore(file)
    await reloaded.load()
    const state = reloaded.current([display])
    expect(state).toEqual({ x: 120, y: 80, width: 1400, height: 900, maximized: false })
  })

  it('ignores a position on a display that is no longer connected', async () => {
    const file = join(dir, 'window-state.json')
    const store = new WindowStateStore(file)
    await store.load()

    const window = trackWith(store, { x: 5000, y: 3200, width: 1000, height: 700 })
    window.fire('move')
    await settle()

    const reloaded = new WindowStateStore(file)
    await reloaded.load()
    const state = reloaded.current([display])
    expect(state.x).toBeUndefined()
    expect(state.y).toBeUndefined()
    expect(state.width).toBe(1000)
  })

  it('repairs sizes below the minimum window size', async () => {
    const file = join(dir, 'window-state.json')
    const store = new WindowStateStore(file)
    await store.load()

    const window = trackWith(store, { x: 10, y: 10, width: 10, height: 10 })
    window.fire('resize')
    await settle()

    const reloaded = new WindowStateStore(file)
    await reloaded.load()
    const state = reloaded.current([display])
    expect(state.width).toBe(760)
    expect(state.height).toBe(540)
  })

  it('stores the normal bounds when the window is maximized', async () => {
    const file = join(dir, 'window-state.json')
    const store = new WindowStateStore(file)
    await store.load()

    const window = trackWith(store, { x: 0, y: 0, width: 1440, height: 900 }, true)
    window.fire('maximize')
    await settle()

    const reloaded = new WindowStateStore(file)
    await reloaded.load()
    expect(reloaded.current([display])).toMatchObject({ width: 1440, height: 900, maximized: true })
  })

  it('falls back to defaults when the file is corrupted', async () => {
    const file = join(dir, 'window-state.json')
    const store = new WindowStateStore(file)
    await store.load()
    const window = trackWith(store, { x: 20, y: 20, width: 900, height: 700 })
    window.fire('resize')
    await settle()

    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'not json at all', 'utf8')

    const recovered = new WindowStateStore(file)
    await recovered.load()
    // The backup written on the second save is used when the primary is broken.
    expect(recovered.current([display]).width).toBeGreaterThanOrEqual(760)
  })
})
