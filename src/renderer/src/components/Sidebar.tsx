import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { BrandMark, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, TrashIcon } from './Icons'
import { Menu, useAnchoredMenu, type MenuItemSpec } from './Menu'
import { formatModelName, groupByBucket } from '@renderer/lib/format'
import type { ConversationSummary } from '@shared/types'

const MIN_WIDTH = 220
const MAX_WIDTH = 460

interface ConversationRowProps {
  conversation: ConversationSummary
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

/** A single history entry: click to open, hover or right-click for actions. */
function ConversationRow({ conversation, active, onSelect, onDelete }: ConversationRowProps): ReactElement {
  const renameConversation = useChatStore((state) => state.renameConversation)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(conversation.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const menu = useAnchoredMenu()

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (nextTitle: string): void => {
    const next = nextTitle.trim()
    setEditing(false)
    if (next && next !== conversation.title) void renameConversation(conversation.id, next)
  }

  const menuItems: MenuItemSpec[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: <PencilIcon size={14} />,
      onSelect: () => {
        setValue(conversation.title)
        setEditing(true)
      }
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon size={14} />,
      danger: true,
      separatorBefore: true,
      onSelect: onDelete
    }
  ]

  return (
    <div
      className={`conversation-row${active ? ' active' : ''}${menu.anchor ? ' menu-open' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        menu.open(event.currentTarget)
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="rename-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => commit(value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(value)
            }
            if (event.key === 'Escape') {
              setValue(conversation.title)
              setEditing(false)
            }
          }}
          aria-label="Conversation title"
        />
      ) : (
        <button type="button" className="title" onClick={onSelect} title={conversation.title}>
          {conversation.title}
        </button>
      )}

      {!editing && (
        <div className="row-buttons">
          <button
            type="button"
            className="icon-button"
            aria-label="Rename conversation"
            title="Rename"
            onClick={(event) => {
              event.stopPropagation()
              setValue(conversation.title)
              setEditing(true)
            }}
          >
            <PencilIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            aria-label="Delete conversation"
            title="Delete"
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      )}

      {menu.anchor && <Menu anchor={menu.anchor} items={menuItems} onClose={menu.close} width={190} />}
    </div>
  )
}

/**
 * Sidebar: brand, quick actions, date-grouped history and the app footer.
 * The width is draggable and remembered between launches.
 */
export function Sidebar(): ReactElement {
  const sidebarWidth = useChatStore((state) => state.settings?.sidebarWidth ?? 268)
  const collapsed = useChatStore((state) => state.sidebarCollapsed)
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeId)
  const models = useChatStore((state) => state.models)
  const activeModel = useChatStore((state) => state.activeModel)
  const appInfo = useChatStore((state) => state.appInfo)
  const previewMode = useChatStore((state) => state.previewMode)

  const newChat = useChatStore((state) => state.newChat)
  const openConversation = useChatStore((state) => state.openConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const setSidebarWidth = useChatStore((state) => state.setSidebarWidth)
  const setPaletteOpen = useChatStore((state) => state.setPaletteOpen)
  const openSettings = useChatStore((state) => state.openSettings)
  const updateSettings = useChatStore((state) => state.updateSettings)

  const modelMenu = useAnchoredMenu()
  const [dragging, setDragging] = useState(false)

  const startResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidebarWidth
      setDragging(true)
      document.body.style.cursor = 'col-resize'

      const onMove = (moveEvent: MouseEvent): void => {
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (moveEvent.clientX - startX)))
        void setSidebarWidth(next, false)
      }
      const onUp = (): void => {
        setDragging(false)
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        void setSidebarWidth(useChatStore.getState().settings?.sidebarWidth ?? startWidth, true)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth, sidebarWidth]
  )

  const groups = groupByBucket(conversations)

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} style={{ width: collapsed ? 0 : sidebarWidth }}>
      <div className="sidebar-inner" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
        <div className="sidebar-header">
          <div className="brand-row">
            <span className="brand-mark">
              <BrandMark size={16} />
            </span>
            <span className="brand-name">GPTN</span>
            {previewMode ? (
              <span className="preview-badge" title="Interface preview — Gemini answers need the desktop app">
                Preview
              </span>
            ) : (
              <span className="brand-version">v{appInfo?.version ?? ''}</span>
            )}
          </div>

          <button type="button" className="sidebar-action" onClick={() => void newChat()}>
            <PlusIcon size={15} />
            New chat
            <span className="shortcut">⌘N</span>
          </button>
          <button type="button" className="sidebar-action" onClick={() => setPaletteOpen(true)}>
            <SearchIcon size={15} />
            Search
            <span className="shortcut">⌘K</span>
          </button>
        </div>

        <div className="sidebar-section">
          <div className="conversation-scroll">
            {conversations.length === 0 ? (
              <div className="sidebar-empty">
                <strong>No conversations yet</strong>
                Start a new chat and it will show up here.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.bucket}>
                  <div className="conversation-group-label">{group.bucket}</div>
                  {group.items.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={conversation.id === activeId}
                      onSelect={() => void openConversation(conversation.id)}
                      onDelete={() => void deleteConversation(conversation.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="model-button"
            onClick={(event) => modelMenu.open(event.currentTarget)}
            title="Choose the model used for new messages"
          >
            <span className="status-dot ok" />
            <span className="model-name">{formatModelName(activeModel)}</span>
          </button>
          <button type="button" className="row-action" onClick={() => openSettings('general')}>
            <SettingsIcon size={15} />
            Settings
            <span className="shortcut">⌘,</span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          className={`sidebar-resizer${dragging ? ' dragging' : ''}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}

      {modelMenu.anchor && (
        <Menu
          anchor={modelMenu.anchor}
          onClose={modelMenu.close}
          width={250}
          items={models.map((model) => ({
            id: model.id,
            label: model.label,
            ...(model.source === 'api' ? { hint: 'API' } : {}),
            checked: model.id === activeModel,
            onSelect: () => void updateSettings({ model: model.id })
          }))}
        />
      )}
    </aside>
  )
}
