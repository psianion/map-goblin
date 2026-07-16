import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  /** Render a divider above this item. */
  separatorBefore?: boolean
}

/** Tracks right-click position; open() opens the menu at the cursor, close() dismisses it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setPos(null), [])
  return { pos, open, close }
}

/**
 * Right-click context menu. Reuses the MapCard menu look-and-feel.
 * Portaled to <body> so it isn't clipped by the layer panel's scroll container.
 */
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

  useEffect(() => {
    if (!pos) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [pos, onClose])

  if (!pos) return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[160px] bg-surface-1 border border-border-default rounded-md shadow-lg py-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="h-px bg-border-default mx-2 my-1" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors',
              item.danger ? 'text-danger' : 'text-text-primary',
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
