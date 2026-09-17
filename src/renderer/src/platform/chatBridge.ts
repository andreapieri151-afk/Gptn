import { api } from './api'
import { useChatStore } from '@renderer/state/store'

/**
 * Bridges main-process events into the renderer store.
 *
 * Streamed text is buffered and flushed on a short timer: React re-renders at a
 * steady pace instead of once per token, which keeps typing smooth even on long
 * answers.
 */
export function installBridge(): () => void {
  const store = useChatStore
  let pendingText = ''
  let pendingThought = ''
  let timer: number | null = null

  const flush = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (!pendingText && !pendingThought) return
    const text = pendingText
    const thought = pendingThought
    pendingText = ''
    pendingThought = ''
    store.getState().applyDelta(text, thought)
  }

  const schedule = (): void => {
    if (timer !== null) return
    timer = window.setTimeout(flush, 33)
  }

  const offDelta = api.chat.onDelta((event) => {
    if (event.text) pendingText += event.text
    if (event.thought) pendingThought += event.thought
    schedule()
  })

  const offDone = api.chat.onDone((event) => {
    flush()
    store.getState().completeStream({
      requestId: event.requestId,
      text: event.text,
      interrupted: event.interrupted,
      ...(event.usage ? { usage: event.usage } : {}),
      ...(event.finishReason ? { finishReason: event.finishReason } : {}),
      ...(event.thought ? { thought: event.thought } : {})
    })
  })

  const offError = api.chat.onError((event) => {
    flush()
    store.getState().failStream({
      requestId: event.requestId,
      error: event.error,
      ...(event.partialText ? { partialText: event.partialText } : {}),
      ...(event.thought ? { thought: event.thought } : {})
    })
  })

  const offConversations = api.conversations.onChanged(() => {
    void store.getState().refreshConversations()
  })

  const offSettings = api.settings.onChanged((settings) => {
    useChatStore.setState({ settings, sidebarCollapsed: settings.sidebarCollapsed })
  })

  const offCommands = api.app.onCommand((command) => {
    const state = store.getState()
    switch (command) {
      case 'ui:new-chat':
        void state.newChat()
        break
      case 'ui:search':
        state.setPaletteOpen(true)
        break
      case 'ui:settings':
        state.openSettings()
        break
      case 'ui:toggle-sidebar':
        state.toggleSidebar()
        break
      case 'ui:focus-composer':
        document.getElementById('composer-input')?.focus()
        break
      case 'ui:export-active':
        if (state.activeId) void state.exportConversations('markdown', [state.activeId])
        break
      case 'ui:copy-last-answer': {
        const last = [...state.messages].reverse().find((message) => message.role === 'assistant')
        if (last?.content) {
          void navigator.clipboard.writeText(last.content).then(() => state.pushToast('Answer copied', 'success'))
        }
        break
      }
      default:
        break
    }
  })

  return () => {
    if (timer !== null) window.clearTimeout(timer)
    offDelta()
    offDone()
    offError()
    offConversations()
    offSettings()
    offCommands()
  }
}
