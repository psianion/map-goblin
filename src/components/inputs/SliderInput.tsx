import { useRef } from 'react'

interface SliderInputProps {
  value: number
  onChange: (value: number) => void
  /** Called when drag ends with (newValue, startValue) for undoable commits */
  onChangeCommit?: (newValue: number, startValue: number) => void
  min: number
  max: number
  step: number
}

export function SliderInput({ value, onChange, onChangeCommit, min, max, step }: SliderInputProps) {
  const startRef = useRef(value)

  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      className="w-full accent-accent"
      onPointerDown={() => {
        startRef.current = value
      }}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => {
        const newVal = Number((e.target as HTMLInputElement).value)
        onChangeCommit?.(newVal, startRef.current)
      }}
    />
  )
}
