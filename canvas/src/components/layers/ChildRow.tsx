import { memo, useState } from 'react'
import { Eye, EyeOff, Square, TreePine, Flame, DoorOpen, Waves, Type } from 'lucide-react'
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
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard'

interface ChildRowProps {
  child: AnyChild
  layer: DungeonLayer
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
  }
}

export const ChildRow = memo(function ChildRow({ child, layer }: ChildRowProps) {
  const layerId = layer.id
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)

  const menu = useContextMenu()
  const isSelected = selectedIds.includes(child.id)
  const [editingName, setEditingName] = useState(false)

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

  const toggleVisibility = () => {
    undoManager.execute(new PropertyCommand(
      child.visible ? 'Hide child' : 'Show child',
      { type: 'child', layerId, childId: child.id },
      { visible: child.visible },
      { visible: !child.visible },
    ))
  }

  // Delete/Duplicate are destructive edits and go through the same owning-layer
  // gate the layers-panel delete shortcut uses (X1) — the row's own visibility
  // toggle stays exempt, matching the layer row's eye still working when locked.

  // Clone with a fresh id and slight offset — same shape as the copy/paste path.
  const duplicate = () => {
    const reason = blockedLayerReason(layer)
    if (reason) {
      notify.warning(reason)
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
    }
    undoManager.execute(new AddChildCommand('Duplicate', layerId, clone))
    notify.action('Duplicated', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'copy' })
  }

  const remove = () => {
    const reason = blockedLayerReason(layer)
    if (reason) {
      notify.warning(reason)
      return
    }
    undoManager.execute(new RemoveChildCommand('Delete', layerId, child.id))
    notify.action('Deleted', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' })
    setSelectedIds(selectedIds.filter((id) => id !== child.id))
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

  return (
    <div
      className={cn(
        'gg-row flex items-center gap-1 pl-8 pr-1 py-1 cursor-pointer',
        isSelected && 'bg-surface-3',
        // opacity-80, matching LayerRow — opacity-50 on text-primary content
        // fails 4.5:1 (see index.css's --text-dim comment).
        !child.visible && 'opacity-80',
      )}
      onClick={handleClick}
      onContextMenu={menu.open}
      data-testid="child-row"
    >
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
      />

      {/* visibility toggle */}
      <Button
        variant="ghost"
        size="icon-xs"
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
