import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '@/store/store'
import { isChildGroupExpanded } from '@/store/selectors'
import type { AnyChild, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { undoManager } from '@/store/undoManager'
import { ReorderChildCommand } from '@/store/commands'
import { computeChildDragReorder } from './childReorder'
import { notify } from '@/lib/toast'
import { ChildRow } from './ChildRow'
import { GroupRow } from './GroupRow'

import { TreeScrollContext } from './treeScroll'

// Prep/interactive rows first, bulk decoration last.
const GROUP_ORDER: AnyChild['childType'][] = ['zone', 'light', 'door', 'water', 'text', 'shape', 'asset']
const GROUP_LABELS: Record<AnyChild['childType'], string> = {
  zone: 'Zones',
  light: 'Lights',
  door: 'Doors',
  water: 'Water',
  text: 'Text',
  shape: 'Shapes',
  asset: 'Assets',
}
// Above this row count a group renders through react-virtual. Below it the
// plain map is simpler and keyboard drag-reorder stays fully functional.
const VIRTUALIZE_THRESHOLD = 80
const ROW_HEIGHT = 26

interface ChildGroupsProps {
  layer: DungeonLayer
  /** Lowercased filter query; '' shows everything. */
  filter: string
}

interface GroupProps {
  layer: DungeonLayer
  childType: AnyChild['childType']
  /** Group children in panel display order (topmost first). */
  children_: AnyChild[]
  filtering: boolean
  posInSet?: number
  setSize?: number
}

function Group({ layer, childType, children_, filtering, posInSet = 1, setSize = 1 }: GroupProps) {
  const key = `${layer.id}:${childType}`
  const toggleChildGroup = useStore((s) => s.toggleChildGroup)
  const storedExpanded = useStore((s) => isChildGroupExpanded(s, layer.id, childType))
  // A live filter overrides collapse — a filter you must un-collapse seven
  // groups to see the results of is not a filter.
  const isExpanded = filtering || storedExpanded

  const headerRef = useRef<HTMLDivElement>(null)

  const handleHeaderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleChildGroup(key)
    } else if (e.key === 'ArrowRight' && !isExpanded) {
      e.preventDefault()
      toggleChildGroup(key)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (isExpanded && !filtering) {
        toggleChildGroup(key)
      } else {
        const root = e.currentTarget.closest('[role="group"]')
        const parentRow = root?.previousElementSibling as HTMLElement | null
        parentRow?.focus()
      }
    }
  }

  return (
    <div>
      <div
        ref={headerRef}
        role="treeitem"
        aria-level={2}
        aria-expanded={isExpanded}
        aria-label={`${GROUP_LABELS[childType]}, ${children_.length}`}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        tabIndex={-1}
        data-testid="child-group-header"
        data-group-header=""
        data-group-type={childType}
        className={cn(
          'gg-row flex items-center gap-1 pl-4 pr-2 py-1 cursor-pointer select-none',
          'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
        )}
        onClick={() => toggleChildGroup(key)}
        onKeyDown={handleHeaderKeyDown}
      >
        <span className="flex items-center justify-center w-3 shrink-0 text-text-muted">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="font-display text-panel-label uppercase tracking-wider text-text-muted">
          {GROUP_LABELS[childType]}
        </span>
        <span className="text-panel-small text-text-muted tabular-nums">{children_.length}</span>
      </div>
      {isExpanded && (
        childType === 'asset' && children_.length > VIRTUALIZE_THRESHOLD
          ? <VirtualChildList layer={layer} children_={children_} />
          : children_.map((child, i) => (
              <ChildRow
                key={child.id}
                child={child}
                layer={layer}
                posInSet={i + 1}
                setSize={children_.length}
              />
            ))
      )}
    </div>
  )
}

function VirtualChildList({ layer, children_ }: { layer: DungeonLayer; children_: AnyChild[] }) {
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

export function ChildGroups({ layer, filter }: ChildGroupsProps) {
  // K2: same sensors as the top-level layer list in LayerPanel.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const childName = (id: string) => layer.children.find((c) => c.id === id)?.name ?? 'item'
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${childName(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over ? `${childName(String(active.id))} is over ${childName(String(over.id))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${childName(String(active.id))} was moved next to ${childName(String(over.id))}.`
        : `${childName(String(active.id))} was dropped.`,
    onDragCancel: ({ active }) => `Reordering ${childName(String(active.id))} was cancelled.`,
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    // Locked blocks reorder like it blocks delete; hidden does not (see
    // LayerRow's deleteLayer comment for the rationale).
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    const result = computeChildDragReorder(layer.children, String(active.id), String(over.id))
    if (!result) return
    undoManager.execute(new ReorderChildCommand('Reorder child', layer.id, result.fromIndex, result.toIndex))
  }

  // Display order (topmost first), then bucketed by type.
  const display = [...layer.children].reverse()
  const q = filter.trim().toLowerCase()

  // Named groups sit above the type buckets, Photoshop-folder style, ordered
  // by their topmost member. Their members leave their type bucket entirely —
  // including when the filter hides the whole group, so a filtered-out group
  // can't leak its members back into Assets.
  const groupedIds = new Set<string>()
  const namedGroups = (layer.groups ?? [])
    .map((group) => {
      const all = display.filter((c) => c.groupId === group.id)
      all.forEach((c) => groupedIds.add(c.id))
      const nameMatch = q === '' || group.name.toLowerCase().includes(q)
      // A group-name match reveals the whole group; otherwise only matching
      // members show (and a member match forces the group open — `filtering`).
      const members = nameMatch ? all : all.filter((c) => c.name.toLowerCase().includes(q))
      return { group, all, members, top: all.length ? display.indexOf(all[0]) : Infinity }
    })
    .filter((g) => g.all.length > 0 && g.members.length > 0)
    .sort((a, b) => a.top - b.top)

  const groups = GROUP_ORDER
    .map((type) => ({
      type,
      children: display.filter(
        (c) =>
          c.childType === type &&
          !groupedIds.has(c.id) &&
          (q === '' || c.name.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.children.length > 0)

  if (groups.length === 0 && namedGroups.length === 0) return null
  const levelCount = namedGroups.length + groups.length

  return (
    <div id={`${layer.id}-children`} role="group" aria-label={`${layer.name} children`}>
      {/* One DndContext for the whole block — ChildRow's useSortable needs
          the ancestor even for types that render no grip (their rows are
          inert members). Each group is its own SortableContext so a drag
          can only land inside its own type. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
        accessibility={{ announcements }}
      >
        {namedGroups.map((g, i) => (
          <SortableContext
            key={g.group.id}
            items={g.members.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <GroupRow
              layer={layer}
              group={g.group}
              members={g.members}
              totalMembers={g.all.length}
              filtering={q !== ''}
              posInSet={i + 1}
              setSize={levelCount}
            />
          </SortableContext>
        ))}
        {groups.map((g, i) => (
          <SortableContext
            key={g.type}
            items={g.children.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <Group
              layer={layer}
              childType={g.type}
              children_={g.children}
              filtering={q !== ''}
              posInSet={namedGroups.length + i + 1}
              setSize={levelCount}
            />
          </SortableContext>
        ))}
      </DndContext>
    </div>
  )
}
