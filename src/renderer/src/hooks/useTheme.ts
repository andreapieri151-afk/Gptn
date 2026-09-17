import { useEffect } from 'react'
import { useChatStore } from '@renderer/state/store'

/**
 * Applies the theme to the document. `system` follows macOS through
 * `prefers-color-scheme` (which the main process drives via nativeTheme),
 * while Light/Dark pin the palette explicitly.
 */
export function useTheme(): void {
  const theme = useChatStore((state) => state.settings?.theme ?? 'system')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.dataset.theme = theme
  }, [theme])
}
