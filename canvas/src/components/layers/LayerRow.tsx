import { memo, useState } from 'react'
import { Eye, EyeOff, Lock, Unlock, GripVertical, ChevronRight, ChevronDown } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Layer, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand, RemoveLayerCommand } from '@/store/commands'
import { Button } from '@/components/ui/button'
import { ChildRow } from './ChildRow'
import { InlineEditableName } from './InlineEditableName'
import { notify } from '@/lib/toast'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'

interface LayerRowProps {
  layer: Layer
  isActive: boolean
}

export const LayerRow = memo(function LayerRow({ layer, isActive }: LayerRowProps) {
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

  const [editingName, setEditingName] = useState(false)

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
    // is the only visibility change that should happen here).
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

  const deleteLayer = () => {
    undoManager.execute(new RemoveLayerCommand('Delete layer', layer.id))
    notify.action('Layer deleted', {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'trash',
    })
  }

  // Menu items mirror the row toolbar; delete only offered for non-background layers
  // (removeLayer refuses to remove the background layer).
  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', onSelect: () => setEditingName(true) },
    { label: layer.locked ? 'Unlock' : 'Lock', onSelect: toggleLock },
    { label: layer.visible ? 'Hide' : 'Show', onSelect: toggleVisibility },
    ...(layer.type !== 'background'
      ? [{ label: 'Delete Layer', onSelect: deleteLayer, danger: true, separatorBefore: true } as ContextMenuItem]
      : []),
  ]

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-75 z-50')}>
      {/* Layer row */}
      <div
        data-testid="layer-row"
        className={cn(
          // Selection reads as a raised surface, not an accent side-stripe: `gg-row`
          // carries the mode-correct hover (flat tint by day, glow from below at night).
          'gg-row flex items-center gap-1 px-1 py-1.5 cursor-pointer',
          isActive && 'bg-surface-3',
          !layer.visible && 'opacity-50',
        )}
        onClick={handleLayerClick}
        onContextMenu={menu.open}
      >
        {/* drag handle */}
        {layer.type !== 'background' ? (
          <span
            {...attributes}
            {...listeners}
            className="text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </span>
        ) : (
          <span className="w-[14px]" />
        )}

        {/* expand/collapse chevron — only for dungeon layers */}
        {isDungeon ? (
          <button
            type="button"
            className={cn(
              'flex items-center justify-center w-4 h-4 shrink-0 text-text-muted hover:text-text-primary transition-colors',
              !hasChildren && 'opacity-30 pointer-events-none',
            )}
            onClick={handleChevronClick}
            title={isExpanded ? 'Collapse' : 'Expand'}
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
        />

        {/* lock toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            toggleLock()
          }}
          className="text-text-muted hover:text-text-primary"
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
        >
          {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </Button>

        {/* visibility toggle — alt-click solos this layer instead of hiding it */}
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="layer-visibility-toggle"
          data-visible={layer.visible}
          data-soloed={isSoloed}
          onClick={(e) => {
            e.stopPropagation()
            if (e.altKey && layer.type !== 'background') {
              toggleSoloLayer(layer.id)
            } else {
              toggleVisibility()
            }
          }}
          className={cn(
            isSoloed ? 'text-accent-active hover:text-accent-active' : 'text-text-muted hover:text-text-primary',
          )}
          title={
            layer.type === 'background'
              ? (layer.visible ? 'Hide layer' : 'Show layer')
              : `${layer.visible ? 'Hide layer' : 'Show layer'} (Alt-click to solo)`
          }
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
      </div>

      {/* Children rows — only when dungeon layer is expanded */}
      {isDungeon && isExpanded && dungeonLayer && dungeonLayer.children.length > 0 && (
        <div>
          {dungeonLayer.children.map((child) => (
            <ChildRow key={child.id} child={child} layer={dungeonLayer} />
          ))}
        </div>
      )}

      <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
    </div>
  )
})
