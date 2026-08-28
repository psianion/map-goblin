import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getEntriesByType, getCatalogEntry } from '@dnd/core/src/assets/packCatalog'
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas'

interface TexturePickerProps {
  value: string | undefined
  onChange: (textureId: string | undefined) => void
}

export function TexturePicker({ value, onChange }: TexturePickerProps) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const selectedEntry = value ? getCatalogEntry(value) : undefined

  // Live catalog reads — the floor list follows whatever packs are installed,
  // and the category tabs are the tags actually present on floor entries.
  const allFloors = getEntriesByType('floor')
  const categories = [...new Set(allFloors.flatMap((t) => t.tags))].sort()

  const visibleTextures =
    activeCategory === 'all'
      ? allFloors
      : allFloors.filter((t) => t.tags.includes(activeCategory))

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
          // Portaled to body: hosts with outside-click dismissal (ToolPopover)
          // must not treat clicks in here as outside — same as data-color-picker.
          data-texture-picker
          style={{
            position: 'fixed',
            left: popoverPos.x,
            top: popoverPos.y,
            zIndex: 9999,
            width: 264,
          }}
          className="gg-grain rounded border border-border-structure bg-surface-1 shadow-panel overflow-hidden"
        >
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1 p-2 border-b border-border-subtle">
            {['all', ...categories].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`
                  px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-colors
                  ${activeCategory === cat
                    ? 'bg-surface-3 text-text-primary border border-accent-active/40'
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
                    ? 'border-accent-active bg-surface-3 text-text-primary'
                    : 'border-border-default bg-surface-2 text-text-muted hover:bg-surface-3 hover:border-border-focus'}
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
                      ? 'border-accent-active'
                      : 'border-border-default hover:border-border-focus'}
                  `}
                >
                  <PackThumbnailCanvas textureId={entry.id} />
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
        className="flex items-center gap-2 w-full h-7 px-2 rounded border border-border-default bg-surface-2 hover:border-border-focus transition-colors cursor-pointer"
        aria-label="Pick texture"
      >
        {selectedEntry ? (
          <>
            <span className="w-5 h-5 rounded-sm overflow-hidden shrink-0">
              <PackThumbnailCanvas textureId={selectedEntry.id} />
            </span>
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
