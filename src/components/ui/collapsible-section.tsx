import { useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react'

interface CollapsibleSectionProps {
  id: string
  title: string
  icon: LucideIcon
  defaultOpen?: boolean
  /** Controlled mode: external open state */
  isOpen?: boolean
  /** Controlled mode: called with section id on toggle */
  onToggle?: (id: string) => void
  /** Shown in header when collapsed (e.g. color swatches) */
  preview?: ReactNode
  /** Extra element in header row (e.g. ToggleSwitch) */
  headerExtra?: ReactNode
  children: ReactNode
}

export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  defaultOpen = false,
  isOpen: controlledOpen,
  onToggle,
  preview,
  headerExtra,
  children,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleToggle = () => {
    if (isControlled && onToggle) {
      onToggle(id)
    } else {
      setInternalOpen((prev) => !prev)
    }
  }

  return (
    <div className="bg-surface-2 rounded-md border border-border-default mx-2 mb-2">
      {/* Header */}
      <button
        type="button"
        role="button"
        aria-expanded={open}
        aria-controls={`section-${id}`}
        onClick={handleToggle}
        className={`
          flex items-center gap-2 w-full px-3 py-2 cursor-pointer select-none
          font-mono text-panel-heading uppercase text-text-muted
          hover:bg-surface-3 transition-colors
          ${open ? 'rounded-t-md' : 'rounded-md'}
        `}
      >
        <Icon size={14} className="shrink-0 text-text-muted" />
        <span className="flex-1 text-left">{title.toUpperCase()}</span>
        {!open && preview && <span className="flex items-center gap-1">{preview}</span>}
        {headerExtra && (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center">
            {headerExtra}
          </span>
        )}
        {open
          ? <ChevronDown size={12} className="shrink-0 text-text-muted" />
          : <ChevronRight size={12} className="shrink-0 text-text-muted" />
        }
      </button>

      {/* Content */}
      {open && (
        <div id={`section-${id}`} className="px-3.5 pb-3 pt-1 border-t border-border-default">
          {children}
        </div>
      )}
    </div>
  )
}
