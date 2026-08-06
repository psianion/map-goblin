import { useState } from 'react'
import { useStore } from '@/store/store'
import type { AnyChild, AssetChild, TextChild } from '@/store/types'
import { PropertyField } from './PropertyField'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Move, Lock, LockOpen, FlipHorizontal2, FlipVertical2, RotateCw } from 'lucide-react'
import { UpdateChildCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { selectLayerForChild } from '@/store/selectors'
import { cn } from '@/lib/utils'

/**
 * Numeric field that previews nothing and commits once, on blur or Enter —
 * typing "12" must be one undo entry, not one per keystroke.
 */
function CommitNumberField({
  value,
  onCommit,
  min,
  step = 0.1,
  label,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  step?: number
  label: string
}) {
  const [draft, setDraft] = useState(String(value))
  // External changes (gizmo drag, undo) win over a stale draft. Adjusted
  // during render rather than in an effect — no extra committed frame.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(String(value))
  }

  const commit = () => {
    const v = parseFloat(draft)
    if (isNaN(v) || v === value) {
      setDraft(String(value))
      return
    }
    onCommit(min !== undefined ? Math.max(min, v) : v)
  }

  return (
    <input
      type="number"
      value={draft}
      step={step}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(String(value))
      }}
      className={cn(
        'w-16 h-7 rounded-sm bg-transparent border border-border-default',
        'font-mono text-panel-small text-text-primary px-2 tabular-nums',
        'focus:border-border-focus focus:outline-none transition-colors',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      )}
    />
  )
}

/**
 * Numeric transform editing for box children (assets and labels): position,
 * size, angle, flips. Values are world grid squares; position is the centre.
 * Shapes edit their geometry through node editing, not numbers, so they don't
 * appear here.
 */
export function TransformSection({
  child,
  openSections,
  onToggleSection,
}: {
  child: AssetChild | TextChild
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}) {
  const parentLayer = useStore((s) => selectLayerForChild(s, child.id))
  const [ratioLocked, setRatioLocked] = useState(true)

  if (!parentLayer) return null

  const commit = (label: string, before: Partial<AnyChild>, after: Partial<AnyChild>): void => {
    undoManager.execute(new UpdateChildCommand(label, parentLayer.id, child.id, before, after))
  }

  const isAsset = child.childType === 'asset'
  const degrees = Math.round((child.rotation * 180) / Math.PI * 10) / 10

  return (
    <CollapsibleSection
      id="transform"
      title="Transform"
      icon={Move}
      defaultOpen={true}
      isOpen={openSections?.has('transform')}
      onToggle={onToggleSection}
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Position">
          <div className="flex items-center gap-1.5">
            <CommitNumberField
              label="X position in squares"
              value={Math.round(child.position.x * 100) / 100}
              onCommit={(x) =>
                commit('Move', { position: { ...child.position } }, { position: { x, y: child.position.y } })
              }
            />
            <CommitNumberField
              label="Y position in squares"
              value={Math.round(child.position.y * 100) / 100}
              onCommit={(y) =>
                commit('Move', { position: { ...child.position } }, { position: { x: child.position.x, y } })
              }
            />
          </div>
        </PropertyField>

        {isAsset && (
          <PropertyField label="Size">
            <div className="flex items-center gap-1.5">
              <CommitNumberField
                label="Width in squares"
                value={Math.round(child.width * child.scale * 100) / 100}
                min={0.05}
                onCommit={(w) => {
                  // Fields show effective size; scale is a legacy multiplier the
                  // renderer applies on top, so divide it back out.
                  const width = w / child.scale
                  const height = ratioLocked ? child.height * (width / child.width) : child.height
                  commit('Resize', { width: child.width, height: child.height }, { width, height })
                }}
              />
              <CommitNumberField
                label="Height in squares"
                value={Math.round(child.height * child.scale * 100) / 100}
                min={0.05}
                onCommit={(h) => {
                  const height = h / child.scale
                  const width = ratioLocked ? child.width * (height / child.height) : child.width
                  commit('Resize', { width: child.width, height: child.height }, { width, height })
                }}
              />
              <button
                type="button"
                // The name stays constant and aria-pressed carries the state —
                // "Unlock…" + pressed=true announced the action and its
                // opposite at once.
                title="Lock aspect ratio"
                aria-label="Lock aspect ratio"
                aria-pressed={ratioLocked}
                onClick={() => setRatioLocked((v) => !v)}
                className={cn(
                  'gg-row rounded-sm p-1.5',
                  ratioLocked ? 'text-accent-active' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {ratioLocked ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
            </div>
          </PropertyField>
        )}

        <PropertyField label="Angle">
          <div className="flex items-center gap-1.5">
            <CommitNumberField
              label="Rotation in degrees"
              value={degrees}
              step={5}
              onCommit={(deg) =>
                commit('Rotate', { rotation: child.rotation }, { rotation: (deg * Math.PI) / 180 })
              }
            />
            <button
              type="button"
              title="Rotate 90°"
              aria-label="Rotate 90 degrees"
              onClick={() =>
                commit('Rotate 90°', { rotation: child.rotation }, { rotation: child.rotation + Math.PI / 2 })
              }
              className="gg-row rounded-sm p-1.5 text-text-secondary hover:text-text-primary"
            >
              <RotateCw size={13} />
            </button>
          </div>
        </PropertyField>

        {isAsset && (
          <PropertyField label="Flip">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Flip horizontal"
                aria-label="Flip horizontal"
                aria-pressed={child.flipX}
                onClick={() => commit('Flip horizontal', { flipX: child.flipX }, { flipX: !child.flipX })}
                className={cn(
                  'gg-row rounded-sm p-1.5',
                  child.flipX ? 'text-accent-active' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <FlipHorizontal2 size={13} />
              </button>
              <button
                type="button"
                title="Flip vertical"
                aria-label="Flip vertical"
                aria-pressed={child.flipY}
                onClick={() => commit('Flip vertical', { flipY: child.flipY }, { flipY: !child.flipY })}
                className={cn(
                  'gg-row rounded-sm p-1.5',
                  child.flipY ? 'text-accent-active' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <FlipVertical2 size={13} />
              </button>
            </div>
          </PropertyField>
        )}
      </div>
    </CollapsibleSection>
  )
}
