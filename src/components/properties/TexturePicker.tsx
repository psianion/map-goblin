import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getTexturesByType, getTextureEntry } from '@/assets/textureManifest'
import type { FloorCategory } from '@/assets/textureManifest'

interface TexturePickerProps {
  value: string | undefined
  onChange: (textureId: string | undefined) => void
}

const FLOOR_CATEGORIES: FloorCategory[] = ['grass', 'dirt', 'stone', 'cave', 'gravel', 'wood', 'water']
const ALL_FLOOR_TEXTURES = getTexturesByType('floor')

export function TexturePicker({ value, onChange }: TexturePickerProps) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FloorCategory | 'all'>('all')
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const selectedEntry = value ? getTextureEntry(value) : undefined

  const visibleTextures =
    activeCategory === 'all'
      ? ALL_FLOOR_TEXTURES
      : ALL_FLOOR_TEXTURES.filter((t) => t.category === activeCategory)

  const handleOpen = useCallback(() => {
    if (open) {
      setOpen(false)
      return
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const popoverWidth = 264
      const popoverHeight = 340
      const maxTop = window.innerHeight - popoverHeight - 8
      setPopoverPos({
        x: Math.max(8, rect.left - popoverWidth - 8),
        y: Math.min(rect.top, Math.max(8, maxTop)),
      })
    }
    setOpen(true)
  }, [open])

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
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  const handleSelect = (textureId: string | undefined) => {
    onChange(textureId)
    setOpen(false)
  }

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            left: popoverPos.x,
            top: popoverPos.y,
            zIndex: 9999,
            width: 264,
          }}
          className="rounded border border-border-default bg-surface-1 shadow-lg overflow-hidden"
        >
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1 p-2 border-b border-border-subtle">
            {(['all', ...FLOOR_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`
                  px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-colors
                  ${activeCategory === cat
                    ? 'bg-surface-3 text-text-primary border border-white/20'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text-secondary'}
                `}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Texture grid */}
          <div className="p-2 overflow-y-auto" style={{ maxHeight: 280 }}>
            <div className="grid grid-cols-4 gap-1">
              {/* None option */}
              <button
                type="button"
                onClick={() => handleSelect(undefined)}
                className={`
                  aspect-square rounded flex items-center justify-center text-[9px] font-mono uppercase
                  border transition-colors
                  ${!value
                    ? 'border-white bg-surface-3 text-text-primary'
                    : 'border-border-default bg-surface-2 text-text-muted hover:bg-surface-3 hover:border-white/30'}
                `}
              >
                None
              </button>

              {/* Texture cells */}
              {visibleTextures.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.label}
                  onClick={() => handleSelect(entry.id)}
                  className={`
                    aspect-square rounded overflow-hidden border transition-colors
                    ${value === entry.id
                      ? 'border-white'
                      : 'border-border-default hover:border-white/30'}
                  `}
                >
                  <img
                    src={entry.path}
                    alt={entry.label}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          </div>
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
        className="flex items-center gap-2 w-full h-7 px-2 rounded border border-border-default bg-surface-2 hover:border-white/30 transition-colors cursor-pointer"
        aria-label="Pick texture"
      >
        {selectedEntry ? (
          <>
            <img
              src={selectedEntry.path}
              alt={selectedEntry.label}
              className="w-5 h-5 rounded-sm object-cover shrink-0"
            />
            <span className="font-mono text-[10px] text-text-secondary truncate">
              {selectedEntry.label}
            </span>
          </>
        ) : (
          <span className="font-mono text-[10px] text-text-muted">No texture</span>
        )}
      </button>
      {popover}
    </div>
  )
}
