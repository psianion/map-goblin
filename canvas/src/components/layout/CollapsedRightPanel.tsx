import { Palette, Minus, Sun, Grid3x3, Waves, Lightbulb, Package, PaintBucket, PanelRightOpen } from 'lucide-react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveLayer, selectSelectedIds, selectChildById } from '@/store/selectors'
import type { LucideIcon } from 'lucide-react'

interface StripItem {
  icon: LucideIcon
  label: string
}

const DUNGEON_ITEMS: StripItem[] = [
  { icon: Palette, label: 'Colors' },
  { icon: Minus, label: 'Walls' },
  { icon: Sun, label: 'Shadow' },
  { icon: Grid3x3, label: 'Hatch' },
  { icon: Waves, label: 'Rough' },
  { icon: Lightbulb, label: 'Ambient' },
]

const BG_ITEMS: StripItem[] = [
  { icon: PaintBucket, label: 'BG' },
  { icon: Lightbulb, label: 'Ambient' },
]

const LIGHT_ITEMS: StripItem[] = [
  { icon: Sun, label: 'Light' },
  { icon: Lightbulb, label: 'Ambient' },
]

interface CollapsedRightPanelProps {
  onExpand: (sectionId?: string) => void
}

export function CollapsedRightPanel({ onExpand }: CollapsedRightPanelProps) {
  const activeLayer = useStore(selectActiveLayer)
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const firstSelectedChild = useStore((s) =>
    selectedIds[0] ? selectChildById(s, selectedIds[0]) : undefined,
  )

  const hasSelectedLight = firstSelectedChild?.childType === 'light'

  let items: StripItem[]
  if (hasSelectedLight) items = LIGHT_ITEMS
  else if (activeLayer?.type === 'dungeon') items = DUNGEON_ITEMS
  else if (activeLayer?.type === 'background') items = BG_ITEMS
  else items = [{ icon: Lightbulb, label: 'Ambient' }]

  return (
    <div className="flex flex-col items-center w-12 h-full bg-surface-1 border-l border-border-default py-2">
      {/* Expand button */}
      <button
        type="button"
        onClick={() => onExpand()}
        title="Expand panel"
        className="flex items-center justify-center w-full h-9 cursor-pointer hover:bg-surface-3 transition-colors shrink-0"
      >
        <PanelRightOpen size={16} className="text-text-muted" />
      </button>
      <hr className="border-border-default w-8 my-1" />

      {/* Property section icons — clicking any expands the panel */}
      {items.map(({ icon: Icon, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => onExpand(label.toLowerCase())}
          title={label}
          className="flex flex-col items-center gap-0.5 py-2 cursor-pointer hover:bg-surface-3 w-full transition-colors"
        >
          <Icon size={16} className="text-text-muted" />
          <span className="font-mono text-strip-label uppercase text-text-muted">{label}</span>
        </button>
      ))}

      {/* Divider */}
      <hr className="border-border-default w-8 my-1" />

      {/* Assets shortcut */}
      <button
        type="button"
        onClick={() => onExpand()}
        title="Assets"
        className="flex flex-col items-center gap-0.5 py-2 cursor-pointer hover:bg-surface-3 w-full transition-colors"
      >
        <Package size={16} className="text-text-muted" />
        <span className="font-mono text-strip-label uppercase text-text-muted">Assets</span>
      </button>
    </div>
  )
}
