import { useEffect } from 'react'
import { useChatStore } from '@renderer/state/store'

/**
 * Renderer-side shortcuts. In the packaged app ⌘N / ⌘K / ⌘, are also wired to the
 * native menu bar, so this hook mainly covers Escape handling and browser preview.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useChatStore.getState()
      const meta = event.metaKey || event.ctrlKey

      if (event.key === 'Escape') {
        if (store.paletteOpen) {
          event.preventDefault()
          store.setPaletteOpen(false)
          return
        }
        if (store.settingsOpen) {
          event.preventDefault()
          store.closeSettings()
          return
        }
        if (store.requestId) {
          event.preventDefault()
          void store.stopGeneration()
        }
        return
      }

      if (!meta) return

      if (event.key === 'n') {
        event.preventDefault()
        void store.newChat()
      } else if (event.key === 'k') {
        event.preventDefault()
        store.setPaletteOpen(!store.paletteOpen)
      } else if (event.key === ',') {
        event.preventDefault()
        store.openSettings()
      } else if (event.key === 'b') {
        event.preventDefault()
        store.toggleSidebar()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
