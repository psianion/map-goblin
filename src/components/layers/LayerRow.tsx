import { memo } from 'react'
import { Eye, EyeOff, Lock, Unlock, GripVertical, ChevronRight, ChevronDown } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Layer, DungeonLayer } from '@/store/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand } from '@/store/commands'
import { Button } from '@/components/ui/button'
import { ChildRow } from './ChildRow'

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

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-75 z-50')}>
      {/* Layer row */}
      <div
        data-testid="layer-row"
        className={cn(
          'flex items-center gap-1 px-1 py-1.5 cursor-pointer transition-colors border-l-2',
          isActive ? 'bg-surface-3 border-l-accent-active' : 'border-l-transparent hover:bg-surface-2',
          !layer.visible && 'opacity-50',
        )}
        onClick={handleLayerClick}
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
        <span className="flex-1 min-w-0 truncate text-panel-body text-text-primary">
          {layer.name}
        </span>

        {/* lock toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            undoManager.execute(new PropertyCommand(
              layer.locked ? 'Unlock layer' : 'Lock layer',
              { type: 'layer', layerId: layer.id },
              { locked: layer.locked },
              { locked: !layer.locked },
            ))
          }}
          className="text-text-muted hover:text-text-primary"
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
        >
          {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </Button>

        {/* visibility toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="layer-visibility-toggle"
          data-visible={layer.visible}
          onClick={(e) => {
            e.stopPropagation()
            undoManager.execute(new PropertyCommand(
              layer.visible ? 'Hide layer' : 'Show layer',
              { type: 'layer', layerId: layer.id },
              { visible: layer.visible },
              { visible: !layer.visible },
            ))
          }}
          className="text-text-muted hover:text-text-primary"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
      </div>

      {/* Children rows — only when dungeon layer is expanded */}
      {isDungeon && isExpanded && dungeonLayer && dungeonLayer.children.length > 0 && (
        <div>
          {dungeonLayer.children.map((child) => (
            <ChildRow key={child.id} child={child} layerId={layer.id} />
          ))}
        </div>
      )}
    </div>
  )
})
