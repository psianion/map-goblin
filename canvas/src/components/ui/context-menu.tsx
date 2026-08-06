import { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SliderInput } from '@/components/inputs/SliderInput'
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas'

export interface ContextMenuItem {
  /** Absent means 'action' — the original plain-verb row every menu already uses. */
  type?: 'action'
  label: string
  onSelect: () => void
  danger?: boolean
  /** Render a divider above this item. */
  separatorBefore?: boolean
  /** Greyed out and inert — e.g. Delete on a locked layer. */
  disabled?: boolean
  /** Small leading icon. */
  icon?: ReactNode
  /** Right-aligned shortcut hint, e.g. "Ctrl+D". */
  kbd?: string
}

/** Identity line pinned at the top: what was clicked, in words. */
export interface MenuHeaderRow {
  type: 'header'
  label: string
  sublabel?: string
  icon?: ReactNode
}

export interface MenuToggleRow {
  type: 'toggle'
  label: string
  checked: boolean
  onToggle: (next: boolean) => void
  separatorBefore?: boolean
  disabled?: boolean
}

export interface MenuSliderRow {
  type: 'slider'
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Live preview while dragging — no undo entry per tick. */
  onChange: (v: number) => void
  /** One undoable step from the value the drag started at. */
  onCommit: (next: number, start: number) => void
  separatorBefore?: boolean
  disabled?: boolean
}

export interface MenuSwatchesRow {
  type: 'swatches'
  label: string
  value: string
  options: string[]
  onPick: (color: string) => void
  separatorBefore?: boolean
  disabled?: boolean
}

export interface MenuThumbStripRow {
  type: 'thumbStrip'
  label: string
  items: { id: string; src: string; title: string; active?: boolean }[]
  onPick: (id: string) => void
  /** Optional trailing verb, e.g. "More…" into the full browser. */
  trailing?: { label: string; onSelect: () => void }
  separatorBefore?: boolean
  disabled?: boolean
}

/** Expands inline below its row rather than flying out — clamps and keyboard nav stay trivial. */
export interface MenuSubmenuRow {
  type: 'submenu'
  label: string
  icon?: ReactNode
  rows: MenuRow[]
  separatorBefore?: boolean
  disabled?: boolean
}

export type MenuRow =
  | ContextMenuItem
  | MenuHeaderRow
  | MenuToggleRow
  | MenuSliderRow
  | MenuSwatchesRow
  | MenuThumbStripRow
  | MenuSubmenuRow

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
 * All enabled, focusable controls inside a menu container, in DOM order.
 * Range inputs come from SliderInput and are focusable as-is: Up/Down move
 * between rows (handled below), Left/Right adjust the focused slider.
 */
function menuItemEls(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-menu-focusable]:not(:disabled), input[type="range"]:not(:disabled)',
    ),
  )
}

/**
 * L3: clamp a menu's top-left so it stays fully inside the viewport, on both
 * axes — the same cheap clamp covers both the mouse opener (open) and the
 * keyboard opener (openAt), since neither picks a position with the menu's
 * own size in mind.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function clampMenuPosition(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(pos.x, viewport.width - size.width)),
    top: Math.max(0, Math.min(pos.y, viewport.height - size.height)),
  }
}

/**
 * Thumbnail with the asset browser's fallback: manifest paths are dev-only
 * (production nginx serves index.html for them, so the img decodes to
 * nothing without a 404) — on error the texture renders straight from the
 * rehydrated pack, the same source the canvas draws from.
 */
function MenuThumb({ id, src }: { id: string; src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed || !src) return <PackThumbnailCanvas textureId={id} />
  return (
    <img
      src={src}
      alt=""
      className="h-full w-full object-contain"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

function ActionRow({ item, onClose, returnFocus }: {
  item: ContextMenuItem
  onClose: () => void
  returnFocus: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-focusable
      disabled={item.disabled}
      aria-disabled={item.disabled}
      onClick={(e) => {
        // L4: this button lives in the row's React tree even though its
        // DOM is portaled to <body> — React bubbles synthetic events
        // through the component tree, not the real DOM, so an
        // un-stopped click here still reaches the row's own onClick
        // (e.g. re-selecting a child this same click just deleted).
        e.stopPropagation()
        if (item.disabled) return
        onClose()
        // H1: restore focus to the invoking row first — if the item
        // itself moves focus (Rename's autofocus input), that happens
        // after and wins the race; if it doesn't, this is where focus
        // was always meant to land.
        returnFocus()
        item.onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2 text-left px-3 py-1.5 text-sm gg-row',
        'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50',
        item.danger ? 'text-danger' : 'text-text-primary',
        // 60%, not 50: composited on surface-1 the danger/muted inks fell to
        // ~2.6:1 at half opacity — dim enough to read disabled, not illegible.
        item.disabled && 'opacity-60 cursor-not-allowed pointer-events-none',
      )}
    >
      {item.icon || item.kbd ? (
        <>
          {item.icon && <span className="shrink-0 text-text-muted">{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.kbd && (
            <span className="font-mono text-panel-small text-text-muted">{item.kbd}</span>
          )}
        </>
      ) : (
        // Plain verbs keep the label as the button's own text node — existing
        // menus (and their tests) address rows by text and expect the button.
        item.label
      )}
    </button>
  )
}

function Row({ row, onClose, returnFocus }: {
  row: MenuRow
  onClose: () => void
  returnFocus: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const kind = 'type' in row && row.type ? row.type : 'action'

  switch (kind) {
    case 'header': {
      const r = row as MenuHeaderRow
      return (
        <div className="flex items-center gap-2 px-3 pt-1.5 pb-2 border-b border-border-default mb-1">
          {r.icon && <span className="shrink-0 text-text-muted">{r.icon}</span>}
          <div className="min-w-0">
            <div className="truncate text-sm text-text-primary">{r.label}</div>
            {r.sublabel && (
              <div className="font-mono text-panel-small uppercase text-text-muted">{r.sublabel}</div>
            )}
          </div>
        </div>
      )
    }
    case 'toggle': {
      const r = row as MenuToggleRow
      return (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={r.checked}
          data-menu-focusable
          disabled={r.disabled}
          onClick={(e) => {
            e.stopPropagation()
            // The menu stays open: a toggle is a setting, not a verb.
            r.onToggle(!r.checked)
          }}
          className={cn(
            'flex w-full items-center justify-between px-3 py-1.5 text-sm gg-row text-text-primary',
            'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50',
            r.disabled && 'opacity-60 pointer-events-none',
          )}
        >
          <span>{r.label}</span>
          <span
            aria-hidden
            className={cn(
              'h-3.5 w-6 rounded-full border transition-colors relative',
              r.checked ? 'bg-accent-dim border-accent-active' : 'bg-surface-2 border-border-default',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-2 w-2 rounded-full bg-text-primary transition-transform',
                r.checked ? 'translate-x-3' : 'translate-x-0.5',
              )}
            />
          </span>
        </button>
      )
    }
    case 'slider': {
      const r = row as MenuSliderRow
      return (
        <div className={cn('px-3 py-1.5', r.disabled && 'opacity-60')}>
          <div className="mb-1 font-mono text-panel-label uppercase text-text-muted">{r.label}</div>
          <SliderInput
            value={r.value}
            min={r.min}
            max={r.max}
            step={r.step}
            onChange={r.onChange}
            onChangeCommit={r.onCommit}
            disabled={r.disabled}
          />
        </div>
      )
    }
    case 'swatches': {
      const r = row as MenuSwatchesRow
      return (
        <div className={cn('px-3 py-1.5', r.disabled && 'opacity-60')}>
          <div className="mb-1 font-mono text-panel-label uppercase text-text-muted">{r.label}</div>
          <div className="flex gap-1.5" role="group" aria-label={r.label}>
            {r.options.map((color) => {
              const active = color.toLowerCase() === r.value.toLowerCase()
              return (
                <button
                  key={color}
                  type="button"
                  data-menu-focusable
                  title={color}
                  aria-label={color}
                  aria-pressed={active}
                  disabled={r.disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    r.onPick(color)
                  }}
                  className={cn(
                    'h-5 w-5 shrink-0 rounded-full border-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                    active ? 'border-accent-active' : 'border-border-default hover:border-text-secondary',
                  )}
                  style={{ backgroundColor: color }}
                />
              )
            })}
          </div>
        </div>
      )
    }
    case 'thumbStrip': {
      const r = row as MenuThumbStripRow
      return (
        <div className={cn('px-3 py-1.5', r.disabled && 'opacity-60')}>
          <div className="mb-1 font-mono text-panel-label uppercase text-text-muted">{r.label}</div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {r.items.map((it) => (
              <button
                key={it.id}
                type="button"
                data-menu-focusable
                title={it.title}
                aria-label={it.title}
                aria-pressed={it.active}
                disabled={r.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  r.onPick(it.id)
                }}
                className={cn(
                  'h-9 w-9 shrink-0 overflow-hidden rounded-sm border bg-surface-2',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                  it.active ? 'border-accent-active' : 'border-border-default hover:border-text-secondary',
                )}
              >
                <MenuThumb id={it.id} src={it.src} />
              </button>
            ))}
            {r.trailing && (
              <button
                type="button"
                data-menu-focusable
                disabled={r.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                  returnFocus()
                  r.trailing!.onSelect()
                }}
                className="h-9 shrink-0 rounded-sm border border-border-default px-2 text-panel-small text-text-secondary gg-row hover:text-text-primary"
              >
                {r.trailing.label}
              </button>
            )}
          </div>
        </div>
      )
    }
    case 'submenu': {
      const r = row as MenuSubmenuRow
      return (
        <div>
          <button
            type="button"
            role="menuitem"
            aria-expanded={expanded}
            data-menu-focusable
            disabled={r.disabled}
            aria-disabled={r.disabled}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm gg-row text-text-primary',
              'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50',
              r.disabled && 'opacity-60 cursor-not-allowed pointer-events-none',
            )}
          >
            {r.icon && <span className="shrink-0 text-text-muted">{r.icon}</span>}
            <span className="flex-1">{r.label}</span>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {expanded && (
            <div className="ml-3 border-l border-border-default">
              {r.rows.map((sub, i) => (
                <Row key={i} row={sub} onClose={onClose} returnFocus={returnFocus} />
              ))}
            </div>
          )}
        </div>
      )
    }
    default:
      return <ActionRow item={row as ContextMenuItem} onClose={onClose} returnFocus={returnFocus} />
  }
}

/**
 * Right-click context menu. Reuses the MapCard menu look-and-feel.
 * Portaled to <body> so it isn't clipped by the layer panel's scroll container.
 *
 * Accepts either the legacy `label + onSelect` items or the full typed row
 * union — the renderer switches on row type and never on what the menu is for.
 */
export function ContextMenu({
  pos,
  onClose,
  items,
}: {
  pos: { x: number; y: number } | null
  onClose: () => void
  items: MenuRow[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Element focused before the menu opened — Escape returns focus here
  // rather than leaving it stranded on a now-unmounted menuitem.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Move focus into the menu (first enabled control) the moment it opens.
  useEffect(() => {
    if (!pos) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    menuItemEls(ref.current)[0]?.focus()
  }, [pos])

  // L3: mutates the portaled node's style directly, post-layout, instead of
  // round-tripping through state — offsetWidth/Height are 0 in jsdom, so
  // this degrades to a no-op there (see clampMenuPosition's own test for the
  // actual math, exercised with real sizes).
  useLayoutEffect(() => {
    if (!pos || !ref.current) return
    const el = ref.current
    const { left, top } = clampMenuPosition(
      pos,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    el.style.left = `${left}px`
    el.style.top = `${top}px`
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
      const current = els.indexOf(document.activeElement as HTMLElement)
      // Left/Right are deliberately untouched: a focused slider consumes them
      // to adjust its value.
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

  const returnFocus = () => returnFocusRef.current?.focus()

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className="gg-grain fixed z-50 min-w-[180px] max-w-[260px] bg-surface-1 border border-border-structure rounded-md shadow-panel py-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((row, i) => (
        <div key={i}>
          {'separatorBefore' in row && row.separatorBefore && (
            <div className="h-px bg-border-default mx-2 my-1" />
          )}
          <Row row={row} onClose={onClose} returnFocus={returnFocus} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
