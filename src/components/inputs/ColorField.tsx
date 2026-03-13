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
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return

    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
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
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        const popoverWidth = 232
        const popoverHeight = 300
        const maxTop = window.innerHeight - popoverHeight - 8
        setPopoverPos({
          x: rect.left - popoverWidth - 8,
          y: Math.min(rect.top, Math.max(8, maxTop)),
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
      if (e.key === 'Enter') handleHexSubmit()
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
          className="rounded border border-border-default bg-surface-1 p-3 shadow-lg"
        >
          <HexColorPicker color={value} onChange={handlePickerChange} />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => {
              const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
              setHexInput(v)
            }}
            onBlur={handleHexSubmit}
            onKeyDown={handleHexKeyDown}
            maxLength={7}
            className="mt-2 w-full h-7 bg-transparent border border-border-default rounded px-2
                       font-mono text-panel-body text-text-primary focus:border-border-focus outline-none"
            aria-label="Hex color value"
          />
        </div>,
        document.body,
      )
    : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 bg-surface-1 rounded border border-white/[0.08] px-2 h-7 cursor-pointer hover:border-border-focus transition-colors"
        aria-label="Pick color"
      >
        <span
          className="w-[22px] h-[22px] rounded-[3px] border border-white/10 shrink-0"
          style={{ backgroundColor: value }}
        />
        <span className="font-mono text-[11px] text-text-primary">
          {value.toUpperCase()}
        </span>
      </button>
      {popover}
    </div>
  )
}
