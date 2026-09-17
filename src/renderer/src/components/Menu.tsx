import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CheckIcon } from './Icons'

export interface MenuItemSpec {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface MenuProps {
  anchor: DOMRect
  items: MenuItemSpec[]
  onClose: () => void
  align?: 'start' | 'end'
  width?: number
}

/**
 * Lightweight popover menu anchored to a trigger element. Positioned inside the
 * window and dismissed on outside click, Escape or window resize.
 */
export function Menu({ anchor, items, onClose, align = 'start', width }: MenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const margin = 8
    let left = align === 'end' ? anchor.right - rect.width : anchor.left
    left = Math.min(Math.max(margin, left), window.innerWidth - rect.width - margin)
    // Prefer opening upwards when there is no room below (sidebar footer, composer).
    const below = anchor.bottom + 6
    const top = below + rect.height > window.innerHeight - margin ? Math.max(margin, anchor.top - rect.height - 6) : below
    setPosition({ left, top })
  }, [anchor, align])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        ...(width ? { minWidth: width } : {})
      }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="menu-separator" />}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={item.disabled}
            style={item.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.hint && <span className="shortcut" style={{ marginLeft: 'auto' }}>{item.hint}</span>}
            {item.checked && <CheckIcon size={14} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
          </button>
        </div>
      ))}
    </div>
  )
}

/** Tracks a click-anchored menu: the trigger rect plus open/close helpers. */
export function useAnchoredMenu(): {
  anchor: DOMRect | null
  open: (element: HTMLElement) => void
  close: () => void
} {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return {
    anchor,
    open: (element: HTMLElement) => setAnchor(element.getBoundingClientRect()),
    close: () => setAnchor(null)
  }
}
