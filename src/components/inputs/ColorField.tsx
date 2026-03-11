import { useRef } from 'react'

interface ColorFieldProps {
  value: string
  onChange: (color: string) => void
  /** Called when picker closes with (newColor, startColor) for undoable commits */
  onChangeCommit?: (newColor: string, startColor: string) => void
}

export function ColorField({ value, onChange, onChangeCommit }: ColorFieldProps) {
  const startRef = useRef(value)

  return (
    <input
      type="color"
      value={value}
      className="h-7 w-full cursor-pointer rounded border border-border-default bg-surface-2"
      onFocus={() => {
        startRef.current = value
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        onChangeCommit?.(e.target.value, startRef.current)
      }}
    />
  )
}
