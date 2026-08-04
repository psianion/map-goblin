import { memo, useRef, useState } from 'react'
import { Eye, EyeOff, Lock, Unlock, GripVertical, ChevronRight, ChevronDown } from 'lucide-react'
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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { Layer, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds, isLayerEffectivelyVisible } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand, ReorderChildCommand, RemoveLayerCommand } from '@/store/commands'
import { Button } from '@/components/ui/button'
import { ChildRow } from './ChildRow'
import { InlineEditableName } from './InlineEditableName'
import { computeChildDragReorder } from './childReorder'
import { notify } from '@/lib/toast'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { captureNeighborFocus } from './treeFocus'

interface LayerRowProps {
  layer: Layer
  isActive: boolean
  /** H3: position/count among this row's tree-level siblings (aria-posinset/aria-setsize). Defaults suit a row rendered standalone (e.g. in tests). */
  posInSet?: number
  setSize?: number
}

export const LayerRow = memo(function LayerRow({ layer, isActive, posInSet = 1, setSize = 1 }: LayerRowProps) {
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const expandedLayerIds = useStore(useShallow((s) => s.ui.expandedLayerIds))
  const toggleExpandedLayerId = useStore((s) => s.toggleExpandedLayerId)
  const activeTool = useStore((s) => s.tools.activeTool)
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const soloLayerId = useStore((s) => s.ui.solo?.layerId ?? null)
  const toggleSoloLayer = useStore((s) => s.toggleSoloLayer)
  const clearSolo = useStore((s) => s.clearSolo)
  const isSoloed = soloLayerId === layer.id
  // What the row shows — layer.visible narrowed by solo, so a layer another
  // row soloed away reads (and looks) hidden here too, not just on canvas.
  const effectivelyVisible = useStore((s) => isLayerEffectivelyVisible(s, layer))

  const [editingName, setEditingName] = useState(false)
  // H1: the treeitem row itself — outlives the rename input/menu, so it's a
  // stable focus target for both the delete-neighbor handoff and the rename
  // exit restore.
  const rowRef = useRef<HTMLDivElement>(null)

  const menu = useContextMenu()

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: layer.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isDungeon = layer.type === 'dungeon'
  const dungeonLayer = isDungeon ? (layer as DungeonLayer) : null
  const isExpanded = expandedLayerIds.includes(layer.id)
  const hasChildren = isDungeon && (dungeonLayer?.children.length ?? 0) > 0

  // K2: keyboard reorder for this layer's children list — same sensors as
  // the top-level layer list in LayerPanel.
  const childSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const childName = (id: string) => dungeonLayer?.children.find((c) => c.id === id)?.name ?? 'item'
  const childAnnouncements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${childName(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over ? `${childName(String(active.id))} is over ${childName(String(over.id))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${childName(String(active.id))} was moved next to ${childName(String(over.id))}.`
        : `${childName(String(active.id))} was dropped.`,
    onDragCancel: ({ active }) => `Reordering ${childName(String(active.id))} was cancelled.`,
  }

  const handleLayerClick = (e: React.MouseEvent) => {
    setActiveLayerId(layer.id)
    // Ctrl+click: select/deselect all children in this layer
    if (isDungeon && dungeonLayer && (activeTool === 'select' || activeTool === 'object') && e.ctrlKey) {
      e.stopPropagation()
      const childIds = dungeonLayer.children.map((c) => c.id)
      const allSelected = childIds.every((id) => selectedIds.includes(id))
      if (allSelected) {
        setSelectedIds(selectedIds.filter((id) => !childIds.includes(id)))
      } else {
        const merged = Array.from(new Set([...selectedIds, ...childIds]))
        setSelectedIds(merged)
      }
    } else {
      // Deselect children when clicking layer row normally
      setSelectedIds([])
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleExpandedLayerId(layer.id)
  }

  const toggleLock = () => {
    const wasLocked = layer.locked
    undoManager.execute(new PropertyCommand(
      wasLocked ? 'Unlock layer' : 'Lock layer',
      { type: 'layer', layerId: layer.id },
      { locked: wasLocked },
      { locked: !wasLocked },
    ))
    notify.subtle(wasLocked ? 'Layer unlocked' : 'Layer locked', { icon: wasLocked ? 'unlock' : 'lock' })
  }

  const toggleVisibility = () => {
    // A manual visibility edit is the user taking back control — drop solo
    // bookkeeping without touching any layer's visible flag (the edit itself
    // is the only visibility change that should happen here). Used by the
    // context menu's Hide/Show item, which is an explicit request and stays
    // exempt from the eye button's solo-exit-only branch below.
    if (useStore.getState().ui.solo) clearSolo()
    const wasVisible = layer.visible
    undoManager.execute(new PropertyCommand(
      wasVisible ? 'Hide layer' : 'Show layer',
      { type: 'layer', layerId: layer.id },
      { visible: wasVisible },
      { visible: !wasVisible },
    ))
    notify.subtle(wasVisible ? 'Layer hidden' : 'Layer visible', { icon: wasVisible ? 'eyeOff' : 'eye' })
  }

  const commitRename = (newName: string) => {
    undoManager.execute(new PropertyCommand(
      'Rename layer',
      { type: 'layer', layerId: layer.id },
      { name: layer.name },
      { name: newName },
    ))
    setEditingName(false)
  }

  const handleChildDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || !dungeonLayer) return

    // Reorder is a destructive-but-undoable panel op, like layer delete
    // (see deleteLayer below) — locked blocks it, but a layer hidden via
    // solo (or its own visibility) is not a reason to refuse reordering
    // rows you can still see and edit in the panel.
    if (dungeonLayer.locked) {
      notify.warning('Layer is locked')
      return
    }

    const result = computeChildDragReorder(dungeonLayer.children, String(active.id), String(over.id))
    if (!result) return

    undoManager.execute(new ReorderChildCommand('Reorder child', layer.id, result.fromIndex, result.toIndex))
  }

  const deleteLayer = () => {
    // Delete only ever reaches a dungeon layer (background is excluded from
    // the menu below), but re-check here too: the row toolbar has no
    // delete button, so this guard only fires from the context menu, which
    // can still be opened and clicked on a layer that got locked since it
    // rendered. Locked is the only thing that blocks a delete — not being
    // soloed (or hidden) is not a reason to refuse deleting a layer you
    // aren't currently looking at, and the action is undoable regardless.
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    // H1: capture the neighbor to focus BEFORE this row is removed from the
    // DOM by the delete below.
    const focusNeighbor = captureNeighborFocus(rowRef.current)
    undoManager.execute(new RemoveLayerCommand('Delete layer', layer.id))
    notify.action('Layer deleted', {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'trash',
    })
    focusNeighbor()
  }

  // K1/K3: row keyboard contract (WAI-ARIA APG treeview). Guarded on
  // target === currentTarget so it only fires when the ROW ITSELF is
  // focused — the grip, chevron, lock and eye button are all nested
  // interactive elements whose own native activation would otherwise
  // double-fire these same actions when a keydown bubbles up from them
  // (see ToggleSwitch's very similar bug this PR also fixed).
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        setActiveLayerId(layer.id)
        setSelectedIds([])
        break
      case 'F2':
        e.preventDefault()
        setEditingName(true)
        break
      case ' ':
        e.preventDefault()
        toggleVisibility()
        break
      case 'Delete':
        if (layer.type !== 'background') {
          e.preventDefault()
          deleteLayer()
        }
        break
      case 'ArrowRight':
        if (isDungeon && hasChildren && !isExpanded) {
          e.preventDefault()
          toggleExpandedLayerId(layer.id)
        }
        break
      case 'ArrowLeft':
        if (isDungeon && isExpanded) {
          e.preventDefault()
          toggleExpandedLayerId(layer.id)
        }
        break
      case 'ContextMenu':
        e.preventDefault()
        menu.openAt(e.currentTarget.getBoundingClientRect().left + 8, e.currentTarget.getBoundingClientRect().bottom)
        break
      case 'F10':
        if (e.shiftKey) {
          e.preventDefault()
          menu.openAt(e.currentTarget.getBoundingClientRect().left + 8, e.currentTarget.getBoundingClientRect().bottom)
        }
        break
      default:
        break
    }
  }

  // Menu items mirror the row toolbar; delete only offered for non-background layers
  // (removeLayer refuses to remove the background layer). Delete is greyed out when
  // locked specifically (the common, expected case) — deleteLayer's own guard above
  // also catches the rarer hidden-via-solo edge case at click time.
  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', onSelect: () => setEditingName(true) },
    { label: layer.locked ? 'Unlock' : 'Lock', onSelect: toggleLock },
    { label: layer.visible ? 'Hide' : 'Show', onSelect: toggleVisibility },
    ...(layer.type !== 'background'
      ? [{
          label: 'Delete Layer',
          onSelect: deleteLayer,
          danger: true,
          separatorBefore: true,
          disabled: layer.locked,
        } as ContextMenuItem]
      : []),
  ]

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-75 z-50')}>
      {/* Layer row */}
      <div
        ref={rowRef}
        data-testid="layer-row"
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={isDungeon && hasChildren ? isExpanded : undefined}
        // L1: just the name, so AT reads "Corridor, tree item" instead of
        // concatenating the nested buttons' own aria-labels.
        aria-label={layer.name}
        // H3: the children <div role="group"> below is a DOM sibling (inside
        // a roleless wrapper), not a DOM descendant — restructuring it inside
        // this row would break the row's own flex layout (icon/name/buttons
        // in a horizontal line vs. a block list below). aria-owns is the
        // standard-compliant way to keep the tree relationship explicit
        // without moving markup; aria-level/posinset/setsize complete the
        // APG treeview contract for this node.
        aria-owns={isDungeon && hasChildren && isExpanded ? `${layer.id}-children` : undefined}
        aria-level={1}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        tabIndex={isActive ? 0 : -1}
        className={cn(
          // Selection reads as a raised surface, not an accent side-stripe: `gg-row`
          // carries the mode-correct hover (flat tint by day, glow from below at night).
          'gg-row flex items-center gap-1 px-1 py-1.5 cursor-pointer',
          // K1: same ring treatment as Button, applied only via focus-visible
          // so a mouse click never paints it — border is always-present-but-
          // transparent so the ring doesn't shift row height on focus.
          'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
          isActive && 'bg-surface-3',
          // opacity-80 (not 50): row text sits at text-primary, which only
          // clears 4.5:1 against surface-1/3 in both themes down to ~75%
          // alpha (see index.css token comment) — 80 keeps a safety margin.
          !effectivelyVisible && 'opacity-80',
        )}
        onClick={handleLayerClick}
        onContextMenu={menu.open}
        onKeyDown={handleRowKeyDown}
      >
        {/* drag handle — a deliberate second tab stop per row (K2): dnd-kit's
            keyboard sensor lifts/drops on Enter/Space ON THE HANDLE itself,
            so it keeps its own native tabIndex from `attributes` rather than
            folding into the row's roving tabindex above. */}
        {layer.type !== 'background' ? (
          <span
            {...attributes}
            {...listeners}
            // H2: attributes spreads dnd-kit's own tabIndex=0, which would
            // add a second permanent tab stop per row (N+1 total). Override
            // it after the spread so the grip roves with its row instead.
            tabIndex={isActive ? 0 : -1}
            role="button"
            aria-label={`Reorder ${layer.name}`}
            className="text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing rounded-sm focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50 border border-transparent"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </span>
        ) : (
          <span className="w-[14px]" />
        )}

        {/* expand/collapse chevron — only for dungeon layers. tabIndex=-1:
            reachable via the row's own ArrowRight/ArrowLeft instead of a
            separate tab stop (see handleRowKeyDown). */}
        {isDungeon ? (
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              'flex items-center justify-center w-4 h-4 shrink-0 transition-colors',
              // text-dim instead of text-muted + opacity-30: text-muted only
              // clears 4.5:1 at full alpha, so fading it further broke contrast.
              hasChildren ? 'text-text-muted hover:text-text-primary' : 'text-text-dim pointer-events-none',
              'focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50 border border-transparent rounded-sm',
            )}
            onClick={handleChevronClick}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {/* name */}
        <InlineEditableName
          value={layer.name}
          editing={editingName}
          onStartEdit={() => setEditingName(true)}
          onCommit={commitRename}
          onCancel={() => setEditingName(false)}
          displayClassName="text-panel-body text-text-primary"
          restoreFocusRef={rowRef}
        />

        {/* lock toggle — tabIndex=-1: reachable via the row menu (Shift+F10),
            like the eye button below (Space handles that one directly). */}
        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            toggleLock()
          }}
          className="text-text-muted hover:text-text-primary"
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          aria-pressed={layer.locked}
        >
          {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </Button>

        {/* visibility toggle — alt-click solos this layer instead of hiding it.
            Icon/title read the AUTHORED layer.visible, never the effective one:
            a row another row soloed away still shows its own true state here,
            and the row's opacity (above, driven by effectivelyVisible) is what
            carries the "soloed away" read instead. */}
        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          data-testid="layer-visibility-toggle"
          data-visible={layer.visible}
          data-effective={effectivelyVisible}
          data-soloed={isSoloed}
          onClick={(e) => {
            e.stopPropagation()
            if (e.altKey && layer.type !== 'background') {
              toggleSoloLayer(layer.id)
              return
            }
            // Solo is active: the eye is reporting/controlling solo, not this
            // layer's own visibility — clicking any row's eye (soloed one
            // included) exits solo and writes nothing. Alt-click above is the
            // only way to change which layer is soloed while solo is active.
            // Background is exempt from solo (always effectively visible), so
            // its eye keeps toggling its own visibility even while soloing,
            // rather than reading as a solo control it has no part in.
            if (soloLayerId && layer.type !== 'background') {
              clearSolo()
              return
            }
            toggleVisibility()
          }}
          className={cn(
            isSoloed ? 'text-accent-active hover:text-accent-active' : 'text-text-muted hover:text-text-primary',
          )}
          title={
            layer.type === 'background'
              ? (layer.visible ? 'Hide layer' : 'Show layer')
              : `${layer.visible ? 'Hide layer' : 'Show layer'} (Alt-click to solo)`
          }
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          aria-pressed={layer.visible}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
      </div>

      {/* Children rows — only when dungeon layer is expanded.
          Rendered reversed, same as LayerPanel does for layers: array index 0
          draws first/bottom, so panel-top must show the last (topmost) child. */}
      {isDungeon && isExpanded && dungeonLayer && dungeonLayer.children.length > 0 && (
        <DndContext
          sensors={childSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleChildDragEnd}
          accessibility={{ announcements: childAnnouncements }}
        >
          <SortableContext
            items={[...dungeonLayer.children].reverse().map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div id={`${layer.id}-children`} role="group" aria-label={`${layer.name} children`}>
              {[...dungeonLayer.children].reverse().map((child, i) => (
                <ChildRow
                  key={child.id}
                  child={child}
                  layer={dungeonLayer}
                  posInSet={i + 1}
                  setSize={dungeonLayer.children.length}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
    </div>
  )
})
