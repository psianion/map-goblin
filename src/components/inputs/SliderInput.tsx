import { useRef, type CSSProperties } from 'react'

interface SliderInputProps {
  value: number
  onChange: (value: number) => void
  /** Called when drag ends with (newValue, startValue) for undoable commits */
  onChangeCommit?: (newValue: number, startValue: number) => void
  min?: number
  max?: number
  step?: number
}

export function SliderInput({
  value,
  onChange,
  onChangeCommit,
  min = 0,
  max = 1,
  step = 0.01,
}: SliderInputProps) {
  const startRef = useRef(value)

  const pct = ((value - min) / (max - min)) * 100
  const display = Number.isInteger(step) ? String(value) : value.toFixed(2)

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        className="flex-1 slider-minimal"
        style={{ '--slider-fill': `${pct}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => { startRef.current = value }}
        onPointerUp={(e) => {
          const newVal = Number((e.target as HTMLInputElement).value)
          onChangeCommit?.(newVal, startRef.current)
        }}
      />
      <span className="font-mono text-panel-small text-text-muted w-8 text-right tabular-nums">
        {display}
      </span>
    </div>
  )
}
