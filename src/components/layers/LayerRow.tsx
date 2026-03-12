import { Eye, EyeOff, Lock, Unlock, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Layer } from '@/store/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/store'
import { Button } from '@/components/ui/button'

interface LayerRowProps {
  layer: Layer
  isActive: boolean
}

export function LayerRow({ layer, isActive }: LayerRowProps) {
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const updateLayer = useStore((s) => s.updateLayer)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: layer.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="layer-row"
      className={cn(
        'flex items-center gap-1 px-1 py-1.5 cursor-pointer transition-colors border-l-2',
        isActive ? 'bg-surface-3 border-l-white' : 'border-l-transparent hover:bg-surface-2',
        !layer.visible && 'opacity-50',
        isDragging && 'opacity-75 z-50',
      )}
      onClick={() => {
        setActiveLayerId(layer.id)
        useStore.getState().setSelectedObjectIds([])
      }}
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
          updateLayer(layer.id, { locked: !layer.locked } as Partial<Layer>)
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
          updateLayer(layer.id, { visible: !layer.visible } as Partial<Layer>)
        }}
        className="text-text-muted hover:text-text-primary"
        title={layer.visible ? 'Hide layer' : 'Show layer'}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
    </div>
  )
}
