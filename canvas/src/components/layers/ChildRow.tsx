import { memo } from 'react'
import { Eye, EyeOff, Square, TreePine, Flame, DoorOpen } from 'lucide-react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import { PropertyCommand } from '@/store/commands'
import type { AnyChild } from '@/store/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface ChildRowProps {
  child: AnyChild
  layerId: string
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
  }
}

export const ChildRow = memo(function ChildRow({ child, layerId }: ChildRowProps) {
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)

  const isSelected = selectedIds.includes(child.id)

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
        'flex items-center gap-1 pl-8 pr-1 py-1 cursor-pointer transition-colors border-l-2',
        isSelected
          ? 'bg-surface-3 border-l-accent-active'
          : 'border-l-transparent hover:bg-surface-2',
        !child.visible && 'opacity-50',
      )}
      onClick={handleClick}
      data-testid="child-row"
    >
      {/* type icon */}
      <span className="text-text-muted shrink-0">{childIcon(child.childType)}</span>

      {/* name */}
      <span className="flex-1 min-w-0 truncate text-panel-body text-text-secondary">
        {child.name}
      </span>

      {/* visibility toggle */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation()
          undoManager.execute(new PropertyCommand(
            child.visible ? 'Hide child' : 'Show child',
            { type: 'child', layerId, childId: child.id },
            { visible: child.visible },
            { visible: !child.visible },
          ))
        }}
        className="text-text-muted hover:text-text-primary"
        title={child.visible ? 'Hide' : 'Show'}
      >
        {child.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </Button>
    </div>
  )
})
