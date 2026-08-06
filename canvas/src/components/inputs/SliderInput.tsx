import { useRef, type CSSProperties } from 'react'

interface SliderInputProps {
  value: number
  onChange: (value: number) => void
  /** Called when drag or keyboard interaction ends with (newValue, startValue) for undoable commits */
  onChangeCommit?: (newValue: number, startValue: number) => void
  /**
   * Full-precision value behind a rounded `value` (e.g. opacity displayed as
   * a whole percent). Used only to capture an interaction's start point, so
   * undo restores the exact pre-drag number (0.4251) instead of the
   * display's rounding (0.43) round-tripped back through it.
   */
  rawValue?: number
  min?: number
  max?: number
  step?: number
  /** Appended to the displayed value, e.g. "%" for opacity. */
  unit?: string
  /** Inert and dimmed — e.g. a light's radius on a locked layer. */
  disabled?: boolean
}

export function SliderInput({
  value,
  onChange,
  onChangeCommit,
  rawValue,
  min = 0,
  max = 1,
  step = 0.01,
  unit,
  disabled,
}: SliderInputProps) {
  const startRef = useRef(rawValue ?? value)

  const pct = ((value - min) / (max - min)) * 100
  const display = Number.isInteger(step) ? String(value) : value.toFixed(2)

  const commitIfChanged = (newVal: number): void => {
    if (newVal !== startRef.current) onChangeCommit?.(newVal, startRef.current)
    startRef.current = newVal
  }

  return (
    <div className={`flex items-center gap-2${disabled ? ' opacity-60' : ''}`}>
      <input
        type="range"
        className="flex-1 slider-minimal"
        style={{ '--slider-fill': `${pct}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={() => { startRef.current = rawValue ?? value }}
        onPointerDown={() => { startRef.current = rawValue ?? value }}
        onPointerUp={(e) => commitIfChanged(Number((e.target as HTMLInputElement).value))}
        // Keyboard interaction (arrows/Home/End) never fires pointerup — blur
        // is the session boundary instead, same pattern as the text label
        // field's onFocus/onBlur commit in TextProperties. Also the guard
        // against a pointer drag double-committing: pointerup already moved
        // startRef to the settled value, so a blur right after sees no change.
        onBlur={(e) => commitIfChanged(Number((e.target as HTMLInputElement).value))}
      />
      <span className="font-mono text-panel-small text-text-muted w-10 text-right tabular-nums">
        {display}{unit}
      </span>
    </div>
  )
}
