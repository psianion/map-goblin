import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'

interface ColorFieldProps {
  value: string
  onChange: (color: string) => void
  /** Called when picker closes with (newColor, startColor) for undoable commits */
  onChangeCommit?: (newColor: string, startColor: string) => void
}

function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)
}

function normalizeHex(hex: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const [, r, g, b] = hex
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return hex.toLowerCase()
}

export function ColorField({ value, onChange, onChangeCommit }: ColorFieldProps) {
  const [open, setOpen] = useState(false)
  const [hexInput, setHexInput] = useState(value)
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 })
  const startRef = useRef(value)
  const popoverRef = useRef<HTMLDivElement>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)

  // When picker is closed, display value always mirrors the external prop
  const displayHex = open ? hexInput : value

  // Close on outside click
  useEffect(() => {
    if (!open) return

    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        swatchRef.current &&
        !swatchRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        onChangeCommit?.(value, startRef.current)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, value, onChangeCommit])

  // Close on Escape (stopPropagation to avoid ToolPopover closing)
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        onChangeCommit?.(value, startRef.current)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, value, onChangeCommit])

  const handleOpen = useCallback(() => {
    if (open) {
      setOpen(false)
      onChangeCommit?.(value, startRef.current)
    } else {
      startRef.current = value
      setHexInput(value)
      // Compute position: to the left of the swatch, aligned to its top
      if (swatchRef.current) {
        const rect = swatchRef.current.getBoundingClientRect()
        const popoverWidth = 232 // approximate: 200px picker + padding
        setPopoverPos({
          x: rect.left - popoverWidth - 8,
          y: rect.top,
        })
      }
      setOpen(true)
    }
  }, [open, value, onChangeCommit])

  const handlePickerChange = useCallback(
    (color: string) => {
      setHexInput(color)
      onChange(color)
    },
    [onChange],
  )

  const handleHexSubmit = useCallback(() => {
    if (isValidHex(hexInput)) {
      const normalized = normalizeHex(hexInput)
      setHexInput(normalized)
      onChange(normalized)
    } else {
      setHexInput(value)
    }
  }, [hexInput, value, onChange])

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleHexSubmit()
      }
    },
    [handleHexSubmit],
  )

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            left: Math.max(8, popoverPos.x),
            top: popoverPos.y,
            zIndex: 9999,
          }}
          className="rounded-lg border border-border-default bg-surface-2 p-3 shadow-lg"
        >
          <HexColorPicker color={value} onChange={handlePickerChange} />

          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-text-secondary font-mono">#</span>
            <input
              type="text"
              value={displayHex.replace('#', '')}
              onChange={(e) => setHexInput(`#${e.target.value}`)}
              onBlur={handleHexSubmit}
              onKeyDown={handleHexKeyDown}
              maxLength={6}
              className="h-7 w-full rounded border border-border-default bg-surface-3 px-2 font-mono text-xs text-text-primary focus:border-border-focus focus:outline-none"
              aria-label="Hex color value"
            />
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="relative">
      <button
        ref={swatchRef}
        type="button"
        className="h-7 w-7 rounded border border-border-default cursor-pointer"
        style={{ backgroundColor: value }}
        onClick={handleOpen}
        aria-label="Pick color"
      />
      {popover}
    </div>
  )
}
