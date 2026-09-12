import { useEffect, useRef, useState, type ReactElement } from 'react'
import { selectIsGenerating, useChatStore } from '@renderer/state/store'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import { Menu, useAnchoredMenu } from './Menu'
import { ChevronDownIcon, DownloadIcon, PencilIcon, SidebarIcon, TrashIcon } from './Icons'
import { formatModelName } from '@renderer/lib/format'

/**
 * The chat surface: header (title, model, actions), transcript and composer.
 * Drafts are kept per conversation so switching chats never loses what you typed.
 */
export function ChatView(): ReactElement {
  const activeId = useChatStore((state) => state.activeId)
  const conversations = useChatStore((state) => state.conversations)
  const activeModel = useChatStore((state) => state.activeModel)
  const models = useChatStore((state) => state.models)
  const secrets = useChatStore((state) => state.secrets)
  const sidebarCollapsed = useChatStore((state) => state.sidebarCollapsed)
  const isGenerating = useChatStore(selectIsGenerating)

  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopGeneration = useChatStore((state) => state.stopGeneration)
  const retryLast = useChatStore((state) => state.retryLast)
  const renameConversation = useChatStore((state) => state.renameConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const exportConversations = useChatStore((state) => state.exportConversations)
  const updateSettings = useChatStore((state) => state.updateSettings)
  const toggleSidebar = useChatStore((state) => state.toggleSidebar)
  const openSettings = useChatStore((state) => state.openSettings)

  const [draft, setDraft] = useState('')
  const draftsRef = useRef<Record<string, string>>({})
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const modelMenu = useAnchoredMenu()
  const headerMenu = useAnchoredMenu()

  const summary = conversations.find((conversation) => conversation.id === activeId)
  const title = summary?.title ?? 'New chat'
  const hasApiKey = secrets?.hasApiKey ?? false

  // Keep the draft of every conversation while switching between them.
  useEffect(() => {
    return () => {
      if (activeId) draftsRef.current[activeId] = draft
    }
  }, [activeId, draft])

  useEffect(() => {
    setDraft(draftsRef.current[activeId ?? ''] ?? '')
  }, [activeId])

  useEffect(() => {
    if (renaming) titleInputRef.current?.select()
  }, [renaming])

  const send = (): void => {
    const text = draft.trim()
    if (!text || isGenerating) return
    setDraft('')
    if (activeId) draftsRef.current[activeId] = ''
    void sendMessage(text)
  }

  const pickSuggestion = (prompt: string): void => {
    setDraft(prompt)
    requestAnimationFrame(() => {
      const element = document.getElementById('composer-input') as HTMLTextAreaElement | null
      element?.focus()
      element?.setSelectionRange(prompt.length, prompt.length)
    })
  }

  const commitRename = (): void => {
    setRenaming(false)
    if (activeId && titleDraft.trim() && titleDraft.trim() !== title) {
      void renameConversation(activeId, titleDraft.trim())
    }
  }

  return (
    <>
      <header className="chat-header">
        {sidebarCollapsed && (
          <button
            type="button"
            className="icon-button"
            onClick={toggleSidebar}
            aria-label="Show sidebar"
            title="Show sidebar (⌘B)"
          >
            <SidebarIcon size={16} />
          </button>
        )}

        {renaming ? (
          <input
            ref={titleInputRef}
            className="rename-input"
            style={{ maxWidth: 320 }}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenaming(false)
            }}
            aria-label="Conversation title"
          />
        ) : (
          <button
            type="button"
            className="chat-title"
            onDoubleClick={() => {
              setTitleDraft(title)
              setRenaming(true)
            }}
            title="Double-click to rename"
          >
            <span className="text">{title}</span>
            {activeId && <span className="rename-hint">Rename</span>}
          </button>
        )}

        <div className="header-actions">
          <button
            type="button"
            className="model-pill"
            onClick={(event) => modelMenu.open(event.currentTarget)}
            title="Change model"
          >
            {formatModelName(activeModel)}
            <ChevronDownIcon size={13} />
          </button>

          {activeId && (
            <button
              type="button"
              className="icon-button"
              aria-label="Chat actions"
              title="Chat actions"
              onClick={(event) => headerMenu.open(event.currentTarget)}
            >
              <span style={{ letterSpacing: 1, fontSize: 15, lineHeight: 1 }}>⋯</span>
            </button>
          )}
        </div>
      </header>

      <MessageList
        emptySlot={<EmptyState onPick={pickSuggestion} />}
        onRetry={() => void retryLast()}
      />

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={() => void stopGeneration()}
        isGenerating={isGenerating}
        blocked={!hasApiKey}
        blockedHint="Add your Gemini API key in Settings → AI to start chatting"
      />

      {modelMenu.anchor && (
        <Menu
          anchor={modelMenu.anchor}
          onClose={modelMenu.close}
          align="end"
          width={250}
          items={models.map((model) => ({
            id: model.id,
            label: model.label,
            checked: model.id === activeModel,
            onSelect: () => {
              void updateSettings({ model: model.id })
            }
          }))}
        />
      )}

      {headerMenu.anchor && activeId && (
        <Menu
          anchor={headerMenu.anchor}
          onClose={headerMenu.close}
          align="end"
          items={[
            {
              id: 'rename',
              label: 'Rename chat',
              icon: <PencilIcon size={14} />,
              onSelect: () => {
                setTitleDraft(title)
                setRenaming(true)
              }
            },
            {
              id: 'export',
              label: 'Export as Markdown',
              icon: <DownloadIcon size={14} />,
              onSelect: () => void exportConversations('markdown', [activeId])
            },
            {
              id: 'export-json',
              label: 'Export as JSON',
              icon: <DownloadIcon size={14} />,
              onSelect: () => void exportConversations('json', [activeId])
            },
            {
              id: 'settings',
              label: 'Model settings…',
              separatorBefore: true,
              onSelect: () => openSettings('ai')
            },
            {
              id: 'delete',
              label: 'Delete chat',
              icon: <TrashIcon size={14} />,
              danger: true,
              separatorBefore: true,
              onSelect: () => void deleteConversation(activeId)
            }
          ]}
        />
      )}
    </>
  )
}
