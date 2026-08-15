import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react'

/**
 * Which way is east on this map — the angle the sun rises at, 0 = screen-right, growing
 * clockwise (screen space, y down), which is the same convention `sunAt` reads `orientation`
 * in. Snapped, because "roughly north-east" is the authoring decision, not 37.4°.
 */
const SNAP = 15
const SIZE = 52
const C = SIZE / 2
const NEEDLE = 17

const snap = (deg: number): number => (Math.round(deg / SNAP) * SNAP + 360) % 360

interface OrientationCompassProps {
  /** Degrees, 0-359. */
  value: number
  /** Live — every drag step, no undo entry. */
  onChange: (deg: number) => void
  /** One undo entry when the interaction ends, with the angle it started at. */
  onChangeCommit?: (deg: number, startDeg: number) => void
}

export function OrientationCompass({ value, onChange, onChangeCommit }: OrientationCompassProps) {
  const startRef = useRef(value)
  const svgRef = useRef<SVGSVGElement>(null)

  const angleFrom = (e: ReactPointerEvent): number => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return value
    const deg = Math.atan2(
      e.clientY - (rect.top + rect.height / 2),
      e.clientX - (rect.left + rect.width / 2),
    ) * (180 / Math.PI)
    return snap(deg)
  }

  // Click-to-set and drag are the same gesture: pointer capture means a drag that leaves the
  // 52px dial keeps steering it, which is the difference between a dial and a target.
  const handleDown = (e: ReactPointerEvent): void => {
    startRef.current = value
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(angleFrom(e))
  }

  const handleMove = (e: ReactPointerEvent): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(angleFrom(e))
  }

  const commit = (next: number): void => {
    if (next !== startRef.current) onChangeCommit?.(next, startRef.current)
    startRef.current = next
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? SNAP
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -SNAP
      : 0
    if (!step) return
    e.preventDefault()
    onChange(snap(value + step))
  }

  const rad = (value * Math.PI) / 180
  const tipX = C + NEEDLE * Math.cos(rad)
  const tipY = C + NEEDLE * Math.sin(rad)

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      tabIndex={0}
      aria-label="Map orientation"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={value}
      aria-valuetext={`East at ${value} degrees`}
      className="shrink-0 cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={(e) => commit(angleFrom(e))}
      onKeyDown={handleKeyDown}
      // Keyboard steps never fire pointerup, so blur is their commit boundary — the same
      // start-ref idiom SliderInput uses, and the guard against a drag committing twice.
      onBlur={() => commit(value)}
    >
      <circle cx={C} cy={C} r={22} className="fill-surface-1 stroke-border-default" />
      <circle
        cx={C}
        cy={C}
        r={16}
        fill="none"
        strokeDasharray="2 4"
        className="stroke-border-subtle"
      />
      {[0, 90, 180, 270].map((deg) => {
        const t = (deg * Math.PI) / 180
        return (
          <line
            key={deg}
            x1={C + 18 * Math.cos(t)}
            y1={C + 18 * Math.sin(t)}
            x2={C + 21 * Math.cos(t)}
            y2={C + 21 * Math.sin(t)}
            className="stroke-border-structure"
          />
        )
      })}
      <line x1={C} y1={C} x2={tipX} y2={tipY} strokeWidth={2} className="stroke-accent-active" />
      <circle cx={tipX} cy={tipY} r={5.5} className="fill-accent-active" />
      {/* The letter rides the needle's tip unrotated — a rotated glyph reads as a broken
          label at 7px, and "which way is east" is the whole question this control answers. */}
      <text
        x={tipX}
        y={tipY + 2.4}
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        className="pointer-events-none fill-on-accent font-sans"
      >
        E
      </text>
      <circle cx={C} cy={C} r={2} className="fill-text-secondary" />
    </svg>
  )
}
