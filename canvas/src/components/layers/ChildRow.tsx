import { memo, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Square, TreePine, Flame, DoorOpen, Waves, Type, GripVertical, Crosshair, Zap } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand, AddChildCommand, UpdateChildCommand, createChildRemovalCommand } from '@/store/commands'
import type { AnyChild, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InlineEditableName } from './InlineEditableName'
import { notify } from '@/lib/toast'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { captureNeighborFocus, panelSelectionOrigin } from './treeFocus'
import { panChildIntoView, zoomToChild } from '@/canvas/panToChild'

interface ChildRowProps {
  child: AnyChild
  layer: DungeonLayer
  /** H3: position/count among this row's tree-level siblings (aria-posinset/aria-setsize). Defaults suit a row rendered standalone (e.g. in tests). */
  posInSet?: number
  setSize?: number
}

function childIcon(childType: AnyChild['childType']) {
  switch (childType) {
    case 'shape':
      return <Square size={12} />
    case 'asset':
      return <TreePine size={12} />
    case 'light':
      return <Flame size={12} />
    case 'door':
      return <DoorOpen size={12} />
    case 'water':
      return <Waves size={12} />
    case 'text':
      return <Type size={12} />
    case 'zone':
      return <Crosshair size={12} />
  }
}

export const ChildRow = memo(function ChildRow({ child, layer, posInSet = 1, setSize = 1 }: ChildRowProps) {
  const layerId = layer.id
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const setPanelHoverChildId = useStore((s) => s.setPanelHoverChildId)
  // Canvas pointer hover (select tool) lights this row up in return.
  const canvasHovered = useStore((s) => s.selection.hoveredId === child.id)

  // Zone-only: how many triggers reference this zone, so a DM can tell a
  // wired-up zone from an empty one without expanding it. Selector narrowed
  // to a single number so unrelated store changes (and non-zone rows) don't
  // rerender this row.
  const zoneTriggerCount = useStore((s) =>
    child.childType === 'zone'
      ? (s.prep?.triggers.filter((t) => t.when.zoneId === child.id).length ?? 0)
      : 0,
  )

  const menu = useContextMenu()
  const isSelected = selectedIds.includes(child.id)
  // M1: multi-select would otherwise make every isSelected row its own tab
  // stop — rove on exactly one, the first selected id, same as the row's own
  // tabIndex and its grip's below.
  const isRovingTarget = isSelected && selectedIds[0] === child.id
  const [editingName, setEditingName] = useState(false)
  // H1: the treeitem row itself — stable across the rename-input/menu
  // lifecycle, used for both the delete-neighbor handoff and rename-exit
  // focus restore.
  const rowRef = useRef<HTMLDivElement>(null)

  // Canvas-driven reveal: LayerPanel's selection effect expanded whatever
  // hid this row and set the marker; the rendered row finishes the job.
  const revealed = useStore((s) => s.ui.revealChildId === child.id)
  useEffect(() => {
    if (!revealed) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    useStore.getState().setRevealChildId(null)
  }, [revealed])

  const commitRename = (newName: string) => {
    undoManager.execute(new UpdateChildCommand(
      'Rename',
      layerId,
      child.id,
      { name: child.name },
      { name: newName },
    ))
    setEditingName(false)
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: child.id })
  // dnd-kit owns the ref via setNodeRef; rowRef needs the same DOM node for
  // focus management, so compose both into one callback ref.
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    rowRef.current = el
  }
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Reorder only actually changes anything on screen for assets and text —
  // doors/lights/shapes/water draw from their own pipelines that ignore
  // array order, so their rows get no drag handle rather than a control that
  // silently does nothing.
  const isReorderable = child.childType === 'asset' || child.childType === 'text'

  const toggleVisibility = () => {
    undoManager.execute(new PropertyCommand(
      child.visible ? 'Hide child' : 'Show child',
      { type: 'child', layerId, childId: child.id },
      { visible: child.visible },
      { visible: !child.visible },
    ))
  }

  // Delete/Duplicate are destructive-but-undoable panel ops, like layer delete
  // (see LayerRow's deleteLayer) — locked blocks them, but a layer hidden via
  // solo (or its own visibility) is not a reason to refuse editing rows the
  // user can still see and click in the panel.

  // Clone with a fresh id and slight offset — same shape as the copy/paste path.
  const duplicate = () => {
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    const clone = structuredClone(child)
    clone.id = crypto.randomUUID()
    clone.name = `${child.name} (copy)`
    if ('position' in clone) {
      const c = clone as AnyChild & { position: { x: number; y: number } }
      c.position = { x: c.position.x + 1, y: c.position.y + 1 }
    } else if ('transform' in clone && clone.transform) {
      clone.transform.translate = [clone.transform.translate[0] + 1, clone.transform.translate[1] + 1]
    } else if (clone.childType === 'zone') {
      // Zones keep their position inside `shape` — without this the copy lands
      // exactly on top of the original.
      clone.shape = clone.shape.kind === 'rect'
        ? { ...clone.shape, x: clone.shape.x + 1, y: clone.shape.y + 1 }
        : { ...clone.shape, position: { x: clone.shape.position.x + 1, y: clone.shape.position.y + 1 } }
    }
    undoManager.execute(new AddChildCommand('Duplicate', layerId, clone))
    notify.action('Duplicated', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'copy' })
  }

  const remove = () => {
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    // H1: capture the neighbor to focus BEFORE this row is removed from the DOM.
    const focusNeighbor = captureNeighborFocus(rowRef.current)
    undoManager.execute(createChildRemovalCommand(layerId, child.id, 'Delete'))
    notify.action('Deleted', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' })
    panelSelectionOrigin.current = true
    setSelectedIds(selectedIds.filter((id) => id !== child.id))
    focusNeighbor()
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', onSelect: () => setEditingName(true) },
    { label: 'Duplicate', onSelect: duplicate },
    { label: child.visible ? 'Hide' : 'Show', onSelect: toggleVisibility },
    { label: 'Delete', onSelect: remove, danger: true, separatorBefore: true },
  ]

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Clicking a child in the panel always selects it and switches to select tool
    panelSelectionOrigin.current = true
    setActiveTool('select')
    setActiveLayerId(layerId)
    if (e.ctrlKey || e.metaKey) {
      // Standard multi-select: ctrl toggles membership…
      setSelectedIds(
        isSelected ? selectedIds.filter((id) => id !== child.id) : [...selectedIds, child.id],
      )
    } else if (e.shiftKey) {
      // …shift extends a range from the most recent selection in this layer,
      // in panel display order (children render reversed).
      const display = [...layer.children].reverse().map((c) => c.id)
      const anchor = [...selectedIds].reverse().find((id) => display.includes(id))
      if (!anchor) {
        setSelectedIds([child.id])
        return
      }
      const a = display.indexOf(anchor)
      const b = display.indexOf(child.id)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelectedIds(Array.from(new Set([...selectedIds, ...display.slice(lo, hi + 1)])))
    } else {
      setSelectedIds([child.id])
      // Plain click also brings the object on screen (pan only, no zoom) —
      // not on ctrl/shift, where the camera jumping mid-multi-select would
      // fight the user building the set.
      panChildIntoView(child.id)
    }
  }

  // K1/K3: same row keyboard contract as LayerRow — see its
  // handleRowKeyDown for the target-vs-currentTarget guard rationale
  // (grip/eye button are nested interactive elements whose native
  // activation would otherwise double-fire these on bubble).
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        panelSelectionOrigin.current = true
        setActiveTool('select')
        setActiveLayerId(layerId)
        setSelectedIds([child.id])
        panChildIntoView(child.id)
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
        e.preventDefault()
        remove()
        break
      case 'ArrowLeft': {
        // M3 (APG treeview contract): ArrowLeft on a child moves focus up to
        // its parent — since tree-v2 grouping that's the type-group header.
        // Walk up to the Group wrapper (the nearest ancestor with a header as
        // a direct child — a virtualized row has an extra wrapper between).
        e.preventDefault()
        let el: HTMLElement | null = e.currentTarget.parentElement
        while (el && !el.querySelector(':scope > [data-testid="child-group-header"]')) {
          el = el.parentElement
        }
        const header = el?.querySelector<HTMLElement>(':scope > [data-testid="child-group-header"]')
        header?.focus()
        break
      }
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

  return (
    <div
      ref={setRefs}
      style={dragStyle}
      role="treeitem"
      aria-selected={isSelected}
      // L1: just the name, so AT reads "Torch, tree item" instead of
      // concatenating the nested buttons' own aria-labels.
      aria-label={child.name}
      // H3: level 2 (a child of a layer), plus this row's position among its
      // own layer's children — see LayerRow's aria-owns comment for why the
      // group->treeitem relationship is expressed this way instead of by DOM
      // nesting.
      // Level 3 since the tree-v2 grouping: layer > type group > child.
      aria-level={3}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={isRovingTarget ? 0 : -1}
      className={cn(
        'gg-row group flex items-center gap-1 pl-4 pr-1 py-1 cursor-pointer',
        // K1: same ring treatment as Button/LayerRow, focus-visible only.
        'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
        isSelected && 'bg-surface-3',
        canvasHovered && !isSelected && 'bg-surface-2',
        // opacity-80, matching LayerRow — opacity-50 on text-primary content
        // fails 4.5:1 (see index.css's --text-dim comment).
        !child.visible && 'opacity-80',
        isDragging && 'opacity-75 z-50',
      )}
      onClick={handleClick}
      onDoubleClick={() => zoomToChild(child.id)}
      onContextMenu={menu.open}
      onKeyDown={handleRowKeyDown}
      // Row hover lights the object up on canvas (childHoverHighlight).
      onMouseEnter={() => setPanelHoverChildId(child.id)}
      onMouseLeave={() => setPanelHoverChildId(null)}
      data-testid="child-row"
    >
      {/* drag handle — only for childTypes where reorder actually draws differently.
          Own tab stop (K2) — see LayerRow's grip comment. */}
      {isReorderable ? (
        <span
          {...attributes}
          {...listeners}
          // H2: override the tabIndex=0 the attributes spread hardcodes —
          // the grip roves with its row, same as LayerRow's.
          tabIndex={isRovingTarget ? 0 : -1}
          aria-label={`Reorder ${child.name}`}
          className="text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing rounded-sm focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50 border border-transparent"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </span>
      ) : (
        <span className="w-3" />
      )}

      {/* type icon */}
      <span className="text-text-muted shrink-0">{childIcon(child.childType)}</span>

      {/* name */}
      <InlineEditableName
        value={child.name}
        editing={editingName}
        onStartEdit={() => setEditingName(true)}
        onCommit={commitRename}
        onCancel={() => setEditingName(false)}
        displayClassName="text-panel-body text-text-secondary"
        restoreFocusRef={rowRef}
      />

      {child.childType === 'zone' && zoneTriggerCount > 0 && (
        <span
          className="shrink-0 flex items-center gap-0.5 text-panel-small text-text-muted"
          title={zoneTriggerCount === 1 ? '1 trigger wired to this zone' : `${zoneTriggerCount} triggers wired to this zone`}
        >
          <Zap size={10} />
          {zoneTriggerCount}
        </span>
      )}

      {/* visibility toggle — tabIndex=-1: reachable via the row's Space
          (see handleRowKeyDown) or the row menu, not a separate tab stop. */}
      <Button
        variant="ghost"
        size="icon-xs"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          toggleVisibility()
        }}
        className={cn(
          'text-text-muted hover:text-text-primary',
          // Revealed on hover/focus; stays visible while hidden (the state
          // a user must be able to spot when scanning the list).
          child.visible && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
        title={child.visible ? 'Hide' : 'Show'}
        aria-label={child.visible ? `Hide ${child.name}` : `Show ${child.name}`}
        aria-pressed={child.visible}
      >
        {child.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </Button>

      <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
    </div>
  )
})
