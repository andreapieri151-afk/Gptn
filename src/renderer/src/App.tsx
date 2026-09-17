import { useEffect, useRef, type ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { installBridge } from '@renderer/platform/chatBridge'
import { useTheme } from '@renderer/hooks/useTheme'
import { useKeyboardShortcuts } from '@renderer/hooks/useKeyboardShortcuts'
import { Sidebar } from '@renderer/components/Sidebar'
import { ChatView } from '@renderer/components/ChatView'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Toasts } from '@renderer/components/Toasts'
import { BrandMark } from '@renderer/components/Icons'

function Splash(): ReactElement {
  return (
    <div className="splash">
      <div className="splash-inner">
        <BrandMark size={40} />
        <div>Starting GPTN…</div>
      </div>
    </div>
  )
}

export default function App(): ReactElement {
  const ready = useChatStore((state) => state.ready)
  const bootstrapped = useRef(false)

  useTheme()
  useKeyboardShortcuts()

  useEffect(() => installBridge(), [])

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void useChatStore.getState().bootstrap()
  }, [])

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        {ready ? <ChatView /> : <Splash />}
      </main>
      <CommandPalette />
      <SettingsModal />
      <Toasts />
    </div>
  )
}
