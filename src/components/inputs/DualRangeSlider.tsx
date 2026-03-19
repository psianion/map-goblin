import { useCallback, useRef } from 'react'

interface DualRangeSliderProps {
  min: number
  max: number
  step: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  formatValue?: (v: number) => string
}

export function DualRangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
}: DualRangeSliderProps) {
  const [lo, hi] = value
  const range = max - min
  const loPercent = ((lo - min) / range) * 100
  const hiPercent = ((hi - min) / range) * 100
  const trackRef = useRef<HTMLDivElement>(null)

  const fmt =
    formatValue ?? ((v: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2)))

  const handleLoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newLo = Math.min(Number(e.target.value), hi - step)
      onChange([newLo, hi])
    },
    [hi, step, onChange],
  )

  const handleHiChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newHi = Math.max(Number(e.target.value), lo + step)
      onChange([lo, newHi])
    },
    [lo, step, onChange],
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-panel-small text-text-secondary tabular-nums">
        <span>{fmt(lo)}</span>
        <span>{fmt(hi)}</span>
      </div>
      <div ref={trackRef} className="relative h-4">
        {/* Track background */}
        <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 rounded bg-surface-3" />
        {/* Active range highlight */}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded"
          style={{
            left: `${loPercent}%`,
            width: `${hiPercent - loPercent}%`,
            background: 'var(--foreground)',
          }}
        />
        {/* Low thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={handleLoChange}
          className="dual-range-thumb absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none"
          style={{ zIndex: lo > max - range * 0.1 ? 5 : 3 }}
        />
        {/* High thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={handleHiChange}
          className="dual-range-thumb absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none"
          style={{ zIndex: 4 }}
        />
      </div>
    </div>
  )
}
