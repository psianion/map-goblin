import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/store'
import type { Light } from '@/store/types'
import { Button } from '@/components/ui/button'

interface LightRowProps {
  light: Light
}

export function LightRow({ light }: LightRowProps) {
  const updateLight = useStore((s) => s.updateLight)
  const setSelectedObjectIds = useStore((s) => s.setSelectedObjectIds)
  const selectedObjectIds = useStore((s) => s.ui.selectedObjectIds)

  const isSelected = selectedObjectIds.includes(light.id)

  return (
    <div
      data-testid="light-row"
      className={cn(
        'flex items-center gap-1 px-1 py-1.5 cursor-pointer transition-colors border-l-2',
        isSelected ? 'bg-surface-3 border-l-white' : 'border-l-transparent hover:bg-surface-2',
        !light.visible && 'opacity-50',
      )}
      onClick={() => setSelectedObjectIds([light.id])}
    >
      {/* color swatch */}
      <span className="w-4 flex-shrink-0 flex items-center justify-center">
        <span
          className="w-3 h-3 rounded-full border border-border-default"
          style={{ backgroundColor: light.color }}
        />
      </span>

      {/* spacer to match expand button width in LayerRow */}
      <span className="w-4" />

      {/* light icon indicator */}
      <span className="text-text-secondary text-xs">☀</span>

      {/* name */}
      <span className="flex-1 min-w-0 truncate text-panel-body text-text-primary">
        {light.name}
      </span>

      {/* visibility toggle */}
      <Button
        variant="ghost"
        size="icon-xs"
        data-testid="light-visibility-toggle"
        data-visible={light.visible}
        onClick={(e) => {
          e.stopPropagation()
          updateLight(light.id, { visible: !light.visible })
        }}
        className="text-text-muted hover:text-text-primary"
      >
        {light.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
    </div>
  )
}
