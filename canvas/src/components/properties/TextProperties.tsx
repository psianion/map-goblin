import { useRef } from 'react'
import { useStore } from '@/store/store'
import type { TextChild } from '@/store/types'
import { PropertyField } from './PropertyField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Type, X } from 'lucide-react'
import { UpdateChildCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { selectLayerForChild } from '@/store/selectors'
import { measureLabel } from '@/engine/labelMetrics'

interface TextPropertiesProps {
  label: TextChild
  onDeselect?: () => void
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

const MIN_SIZE = 0.2
const MAX_SIZE = 6

export function TextProperties({
  label,
  onDeselect,
  openSections,
  onToggleSection,
}: TextPropertiesProps) {
  const updateChild = useStore((s) => s.updateChild)
  const parentLayer = useStore((s) => selectLayerForChild(s, label.id))
  /** Text as it was when the field took focus, so blur has a `before` to undo to. */
  const textAtFocus = useRef<string | null>(null)

  /** Live update while typing or dragging — no undo entry per keystroke. */
  const patch = (p: Partial<TextChild>): void => {
    if (!parentLayer) return
    updateChild(parentLayer.id, label.id, p)
  }

  /** One undoable step, from the value the interaction started at. */
  const commit = (before: Partial<TextChild>, after: Partial<TextChild>): void => {
    if (!parentLayer) return
    undoManager.execute(
      new UpdateChildCommand('Edit label', parentLayer.id, label.id, before, after),
    )
  }

  // Text and size both change the box, and the box is what hit testing and the
  // selection gizmo read, so it must be recomputed alongside them.
  const withBox = (text: string, fontSize: number): Partial<TextChild> => ({
    text,
    fontSize,
    ...measureLabel(text, fontSize),
  })

  return (
    <CollapsibleSection
      id="text"
      title="Label"
      icon={Type}
      defaultOpen={true}
      isOpen={openSections?.has('text')}
      onToggle={onToggleSection}
      preview={<ColorChip color={label.color} size="sm" circular />}
      headerExtra={
        onDeselect ? (
          <button
            onClick={onDeselect}
            title="Deselect"
            aria-label="Deselect label"
            className="pr-2 text-text-muted hover:text-text-primary"
          >
            <X size={13} />
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Text">
          <textarea
            value={label.text}
            rows={2}
            aria-label="Label text"
            onChange={(e) => patch(withBox(e.target.value, label.fontSize))}
            // Typing is a live preview; the whole edit lands as one undo step
            // when the field is left. Without this the text was never undoable
            // at all and Ctrl+Z reversed whatever came before it instead.
            onFocus={() => {
              textAtFocus.current = label.text
            }}
            onBlur={() => {
              const before = textAtFocus.current
              textAtFocus.current = null
              if (before === null || before === label.text) return
              commit(withBox(before, label.fontSize), withBox(label.text, label.fontSize))
            }}
            className="w-full resize-y rounded-[4px] border border-border-default bg-surface-2 px-2 py-1 font-mono text-panel-body text-text-primary"
          />
        </PropertyField>

        <PropertyField label="Size">
          <SliderInput
            value={label.fontSize}
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={0.1}
            onChange={(v) => patch(withBox(label.text, v))}
            onChangeCommit={(next, start) =>
              commit(withBox(label.text, start), withBox(label.text, next))
            }
          />
        </PropertyField>

        <PropertyField label="Colour">
          <ColorField
            value={label.color}
            onChange={(color) => patch({ color })}
            onChangeCommit={(next, start) => commit({ color: start }, { color: next })}
          />
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
