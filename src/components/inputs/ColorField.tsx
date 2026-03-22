import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { Copy, Check } from 'lucide-react'

interface ColorFieldProps {
  value: string
  onChange: (color: string) => void
  /** Called when picker closes with (newColor, startColor) for undoable commits */
  onChangeCommit?: (newColor: string, startColor: string) => void
}

function computePickerPosition(triggerRect: DOMRect): { x: number; y: number } {
  const PICKER_W = 232;
  const PICKER_H = 300;
  const GAP = 8;

  const spaceRight = window.innerWidth - triggerRect.right - GAP;
  const spaceLeft = triggerRect.left - GAP;

  let x: number;
  if (spaceRight >= PICKER_W) {
    x = triggerRect.right + GAP;
  } else if (spaceLeft >= PICKER_W) {
    x = triggerRect.left - PICKER_W - GAP;
  } else {
    x = Math.max(GAP, (window.innerWidth - PICKER_W) / 2);
  }

  const maxTop = window.innerHeight - PICKER_H - GAP;
  const y = Math.max(GAP, Math.min(triggerRect.top, maxTop));

  return { x, y };
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
  const [copied, setCopied] = useState(false)
  const startRef = useRef(value)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value.toUpperCase())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [value])

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
        setPopoverPos(computePickerPosition(rect))
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
            left: popoverPos.x,
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
        className="flex items-center gap-1.5 rounded border border-white/[0.08] px-2 h-7 cursor-pointer hover:border-border-focus transition-colors"
        style={{ backgroundColor: value }}
        aria-label="Pick color"
      >
        <span className="font-mono text-[11px] text-white mix-blend-difference">
          {value.toUpperCase()}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={handleCopy}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCopy(e as unknown as React.MouseEvent) }}
          className="flex items-center justify-center ml-auto cursor-pointer"
          aria-label="Copy hex color"
        >
          {copied
            ? <Check size={11} className="text-white mix-blend-difference" />
            : <Copy size={11} className="text-white/60 mix-blend-difference hover:text-white transition-colors" />
          }
        </span>
      </button>
      {popover}
    </div>
  )
}
