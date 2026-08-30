import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '@/store/store'
import type { AnyChild, DungeonLayer } from '@/store/types'
import { ChildRow } from './ChildRow'
import { TreeScrollContext } from './treeScroll'

// Above this row count a list renders through react-virtual. Below it the
// plain map is simpler and keyboard drag-reorder stays fully functional.
export const VIRTUALIZE_THRESHOLD = 80
const ROW_HEIGHT = 26

/**
 * Windowed member list, shared by the asset type bucket and named groups — a
 * 300-member folder mounted 300 rows before this was reused.
 */
export function VirtualChildList({
  layer,
  children_,
}: {
  layer: DungeonLayer
  children_: AnyChild[]
}) {
  const scrollRef = useContext(TreeScrollContext)
  const revealChildId = useStore((s) => s.ui.revealChildId)
  const listRef = useRef<HTMLDivElement>(null)

  // The list starts partway down the scroller (layer rows, other groups sit
  // above it) — without scrollMargin the virtualizer picks its window as if
  // the list began at offset 0 and renders rows past the viewport once you
  // scroll deep. Recomputed every commit (groups above expand/collapse);
  // setState bails when unchanged.
  const [scrollMargin, setScrollMargin] = useState(0)
  // Deliberately dep-less: the offset moves when content ABOVE this list
  // changes (another group expanding), which re-renders this component
  // without changing any dep. setState bails on equal values, so no loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = listRef.current
    const scroller = scrollRef?.current
    if (!el || !scroller) return
    setScrollMargin(
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
    )
  })

  const virtualizer = useVirtualizer({
    count: children_.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin,
    getItemKey: (i) => children_[i].id,
  })

  // Canvas-driven reveal: jump the window to the row, then the rendered
  // ChildRow's own reveal effect fine-scrolls and clears the marker.
  useEffect(() => {
    if (!revealChildId) return
    const idx = children_.findIndex((c) => c.id === revealChildId)
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
  }, [revealChildId, children_, virtualizer])

  // P0 keyboard fix: the tree's DOM-order arrow navigation only sees
  // RENDERED rows, so past the virtual window focus fell off the group onto
  // the pinned rows. Handle Up/Down inside the list: scroll the target index
  // into the window, then focus its row once it exists. Boundary presses
  // (first/last item) fall through to the tree handler on purpose.
  const focusIndex = (idx: number, attempts = 0) => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${idx}"] [data-testid="child-row"]`,
    )
    if (el) el.focus()
    else if (attempts < 6) requestAnimationFrame(() => focusIndex(idx, attempts + 1))
  }
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const wrap = (e.target as HTMLElement).closest('[data-index]')
    if (!wrap) return
    const idx = Number(wrap.getAttribute('data-index'))
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1
    if (next < 0 || next >= children_.length) return
    e.preventDefault()
    e.stopPropagation()
    virtualizer.scrollToIndex(next)
    requestAnimationFrame(() => focusIndex(next))
  }

  return (
    <div
      ref={listRef}
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      onKeyDown={handleListKeyDown}
    >
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={vi.key}
          ref={virtualizer.measureElement}
          data-index={vi.index}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - scrollMargin}px)` }}
        >
          <ChildRow
            child={children_[vi.index]}
            layer={layer}
            posInSet={vi.index + 1}
            setSize={children_.length}
          />
        </div>
      ))}
    </div>
  )
}
