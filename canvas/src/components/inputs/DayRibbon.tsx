import { useMemo, type ReactNode } from 'react'
import { dayGradient, HATCH, ribbonX } from '@/lib/dayRibbon'
import { cn } from '@/lib/utils'

interface DayRibbonProps {
  /** The engine's colour at a clock reading. Memoize it — it keys the gradient. */
  colorAt: (minutes: number) => string
  /** Track height in px. */
  height: number
  /** Hatched: the clock does not reach this map. */
  muted?: boolean
  className?: string
  /** Handles, playhead, scrub — positioned with `ribbonX`, free to overhang the track. */
  children?: ReactNode
}

/** The whole day as one strip of colour, read straight off the engine. */
export function DayRibbon({ colorAt, height, muted, className, children }: DayRibbonProps) {
  const background = useMemo(() => dayGradient(colorAt), [colorAt])

  return (
    <div className={cn('relative', className)}>
      <div
        className="overflow-hidden rounded-chip border border-black/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
        style={{ height, background }}
      >
        {muted && <span className="block h-full w-full" style={{ background: HATCH }} />}
      </div>
      {children}
    </div>
  )
}

/**
 * The playhead. Solid blade where the time is committed to the map (`fixed`), hollow and
 * dashed where it is a local preview — the authority is in the shape, not only in the copy.
 */
export function RibbonHead({ minutes, committed }: { minutes: number; committed?: boolean }) {
  return (
    <span
      className="pointer-events-none absolute -top-1.5 -bottom-1.5 z-20 flex justify-center drop-shadow-[0_0_2px_rgba(0,0,0,.85)]"
      style={{ left: `${ribbonX(minutes)}%` }}
      aria-hidden="true"
    >
      <span className={cn('h-full border-l-2 border-text-primary', !committed && 'border-dashed')} />
      <span
        className={cn(
          'absolute -top-1 h-2 w-2 -translate-y-px rotate-45',
          committed ? 'bg-text-primary' : 'border border-text-primary bg-surface-1',
        )}
      />
    </span>
  )
}
