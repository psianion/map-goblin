import { cn } from '@/lib/utils'

type ChipSize = 'preview' | 'sm' | 'md'

interface ColorChipProps {
  color: string
  /** preview = 56×20 (section header), sm = 14×14 (collapsed), md = 22×22 (picker trigger) */
  size?: ChipSize
  /** Use circular shape instead of rounded rectangle */
  circular?: boolean
  className?: string
}

const SIZE_CLASSES: Record<ChipSize, string> = {
  preview: 'w-chip h-chip rounded-chip',
  sm:      'w-chip-sm h-chip-sm rounded-chip',
  md:      'w-chip-md h-chip-md rounded-chip-md',
}

export function ColorChip({ color, size = 'sm', circular = false, className }: ColorChipProps) {
  return (
    <span
      className={cn(
        SIZE_CLASSES[size],
        circular && 'rounded-full',
        'border border-border-default shrink-0',
        className,
      )}
      style={{ backgroundColor: color }}
    />
  )
}
