import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useChatStore } from '@renderer/state/store'
import { api } from '@renderer/platform/api'
import { highlightMatches } from '@shared/text'
import type { ConversationSummary, SearchHit } from '@shared/types'
import { PlusIcon, SearchIcon, SparkIcon } from './Icons'

interface ResultRow {
  id: string
  title: string
  snippet?: string
  updatedAt?: string
  kind: 'conversation' | 'action'
}

/** ⌘K search across every conversation, plus a couple of quick actions. */
export function CommandPalette(): ReactElement | null {
  const open = useChatStore((state) => state.paletteOpen)
  const conversations = useChatStore((state) => state.conversations)
  const setPaletteOpen = useChatStore((state) => state.setPaletteOpen)
  const openConversation = useChatStore((state) => state.openConversation)
  const newChat = useChatStore((state) => state.newChat)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setSelected(0)
      return
    }
    inputRef.current?.focus()
  }, [open])

  // Full-text search runs in the main process (over the on-disk history).
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api.conversations.search(trimmed).then((results) => {
        if (!cancelled) {
          setHits(results)
          setSelected(0)
        }
      })
    }, 110)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  const rows: ResultRow[] = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return conversations.slice(0, 7).map((conversation: ConversationSummary) => ({
        id: conversation.id,
        title: conversation.title,
        ...(conversation.preview ? { snippet: conversation.preview } : {}),
        kind: 'conversation' as const
      }))
    }
    return hits.map((hit) => ({
      id: hit.conversationId,
      title: hit.title,
      ...(hit.snippet ? { snippet: hit.snippet } : {}),
      kind: 'conversation' as const
    }))
  }, [conversations, hits, query])

  const actions: ResultRow[] = useMemo(
    () => [{ id: '__new', title: 'New chat', kind: 'action' as const }],
    []
  )

  const selectable: ResultRow[] = [...actions, ...rows]

  useEffect(() => {
    if (!open) return
    const element = listRef.current?.querySelectorAll('.palette-item')[selected] as HTMLElement | undefined
    element?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  const close = (): void => setPaletteOpen(false)

  const choose = (row: ResultRow): void => {
    close()
    if (row.kind === 'action') void newChat()
    else void openConversation(row.id)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => Math.min(selectable.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) => Math.max(0, current - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = selectable[selected]
      if (row) choose(row)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="scrim palette-scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Search">
        <div className="palette-input-row">
          <SearchIcon size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="Search conversations…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search conversations"
          />
          <kbd>esc</kbd>
        </div>

        <div className="palette-results" ref={listRef}>
          {selectable.length === 0 ? (
            <div className="palette-empty">No conversations match “{query}”.</div>
          ) : (
            selectable.map((row, index) => (
              <button
                key={row.kind === 'action' ? 'action-new' : row.id}
                type="button"
                className={`palette-item${index === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(row)}
              >
                <span className="palette-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {row.kind === 'action' ? <PlusIcon size={14} /> : <SparkIcon size={13} />}
                  <span>
                    {query.trim()
                      ? highlightMatches(row.title, query).map((part, partIndex) =>
                          part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>
                        )
                      : row.title}
                  </span>
                </span>
                {row.snippet && <span className="palette-snippet">{row.snippet}</span>}
              </button>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span style={{ marginLeft: 'auto' }}>{rows.length} result{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
