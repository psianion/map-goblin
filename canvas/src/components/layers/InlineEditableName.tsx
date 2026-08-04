import { useState } from 'react'
import { cn } from '@/lib/utils'

interface InlineEditableNameProps {
  value: string
  /** Parent owns edit state — a context menu "Rename" item can enter edit mode too, not just the double-click below. */
  editing: boolean
  onStartEdit: () => void
  /** Called with the trimmed, non-empty, changed name. Not called for empty/unchanged input — see InlineEditableName. */
  onCommit: (newName: string) => void
  onCancel: () => void
  displayClassName?: string
}

/**
 * Double-click-to-rename text, shared by LayerRow and ChildRow. Enter/blur
 * commits, Escape cancels, an empty (or unchanged) result is treated as a
 * cancel rather than a rename.
 */
export function InlineEditableName({
  value,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  displayClassName,
}: InlineEditableNameProps) {
  const [draft, setDraft] = useState(value)
  // Seed the draft the moment edit mode turns on — the "adjust state during
  // render" pattern (react.dev/learn/you-might-not-need-an-effect), not an
  // effect, so entering edit mode never costs an extra render.
  const [prevEditing, setPrevEditing] = useState(editing)
  const [prevValue, setPrevValue] = useState(value)
  if (editing !== prevEditing) {
    setPrevEditing(editing)
    setPrevValue(value)
    if (editing) setDraft(value)
  } else if (editing && value !== prevValue) {
    // The committed value moved out from under an open edit (undo/redo, a
    // remote change) — resync so a commit doesn't clobber it with a draft
    // that's now stale.
    setPrevValue(value)
    setDraft(value)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Rename ${value}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
        className="min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-1 text-text-primary outline-none"
      />
    )
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation()
        onStartEdit()
      }}
      className={cn('flex-1 min-w-0 truncate', displayClassName)}
    >
      {value}
    </span>
  )
}
