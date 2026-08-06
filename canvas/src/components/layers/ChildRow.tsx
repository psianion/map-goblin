import { memo, useRef, useState } from 'react'
import { Eye, EyeOff, Square, TreePine, Flame, DoorOpen, Waves, Type, GripVertical, Crosshair } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand, AddChildCommand, RemoveChildCommand, UpdateChildCommand } from '@/store/commands'
import type { AnyChild, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InlineEditableName } from './InlineEditableName'
import { notify } from '@/lib/toast'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { captureNeighborFocus } from './treeFocus'

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
    undoManager.execute(new RemoveChildCommand('Delete', layerId, child.id))
    notify.action('Deleted', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' })
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
    setActiveTool('select')
    setActiveLayerId(layerId)
    if (e.shiftKey) {
      if (isSelected) {
        setSelectedIds(selectedIds.filter((id) => id !== child.id))
      } else {
        setSelectedIds([...selectedIds, child.id])
      }
    } else {
      setSelectedIds([child.id])
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
        setActiveTool('select')
        setActiveLayerId(layerId)
        setSelectedIds([child.id])
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
        // its parent layer row. The children <div role="group"> is a DOM
        // sibling of the parent LayerRow's treeitem (see LayerRow's H3
        // comment for why it's not a descendant) — walk up to that group,
        // then back one sibling to the treeitem that owns it.
        e.preventDefault()
        const group = e.currentTarget.closest('[role="group"]')
        const parentRow = group?.previousElementSibling as HTMLElement | null
        parentRow?.focus()
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
      aria-level={2}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={isRovingTarget ? 0 : -1}
      className={cn(
        'gg-row flex items-center gap-1 pl-4 pr-1 py-1 cursor-pointer',
        // K1: same ring treatment as Button/LayerRow, focus-visible only.
        'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
        isSelected && 'bg-surface-3',
        // opacity-80, matching LayerRow — opacity-50 on text-primary content
        // fails 4.5:1 (see index.css's --text-dim comment).
        !child.visible && 'opacity-80',
        isDragging && 'opacity-75 z-50',
      )}
      onClick={handleClick}
      onContextMenu={menu.open}
      onKeyDown={handleRowKeyDown}
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
        <span className="shrink-0 text-panel-small text-text-muted">{zoneTriggerCount}</span>
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
        className="text-text-muted hover:text-text-primary"
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
