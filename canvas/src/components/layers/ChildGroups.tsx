import { useRef } from 'react'
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
import { VIRTUALIZE_THRESHOLD, VirtualChildList } from './VirtualChildList'

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
