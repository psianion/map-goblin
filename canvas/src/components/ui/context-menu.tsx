import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  /** Render a divider above this item. */
  separatorBefore?: boolean
  /** Greyed out and inert — e.g. Delete on a locked layer. */
  disabled?: boolean
}

/**
 * Tracks right-click position; open() opens the menu at the cursor,
 * openAt() opens it at an explicit point (e.g. a row's bounding rect, for
 * the keyboard-triggered Shift+F10 / ContextMenu-key opener), close()
 * dismisses it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }, [])
  const openAt = useCallback((x: number, y: number) => setPos({ x, y }), [])
  const close = useCallback(() => setPos(null), [])
  return { pos, open, openAt, close }
}

/**
 * Right-click context menu. Reuses the MapCard menu look-and-feel.
 * Portaled to <body> so it isn't clipped by the layer panel's scroll container.
 */
/** All enabled, focusable menuitem buttons inside a menu container, in DOM order. */
function menuItemEls(container: HTMLElement | null): HTMLButtonElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'))
}

export function ContextMenu({
  pos,
  onClose,
  items,
}: {
  pos: { x: number; y: number } | null
  onClose: () => void
  items: ContextMenuItem[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Element focused before the menu opened — Escape returns focus here
  // rather than leaving it stranded on a now-unmounted menuitem.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Move focus into the menu (first enabled item) the moment it opens.
  useEffect(() => {
    if (!pos) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    menuItemEls(ref.current)[0]?.focus()
  }, [pos])

  useEffect(() => {
    if (!pos) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        returnFocusRef.current?.focus()
        return
      }
      // Tab isn't trapped — it closes the menu and lets focus continue
      // its normal course to whatever's next in the document.
      if (e.key === 'Tab') {
        onClose()
        return
      }
      const els = menuItemEls(ref.current)
      if (els.length === 0) return
      const current = els.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        els[(current + 1 + els.length) % els.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        els[(current - 1 + els.length) % els.length]?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        els[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        els[els.length - 1]?.focus()
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pos, onClose])

  if (!pos) return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className="gg-grain fixed z-50 min-w-[160px] bg-surface-1 border border-border-structure rounded-md shadow-panel py-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="h-px bg-border-default mx-2 my-1" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onSelect()
            }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-sm gg-row',
              'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50',
              item.danger ? 'text-danger' : 'text-text-primary',
              item.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
            )}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
