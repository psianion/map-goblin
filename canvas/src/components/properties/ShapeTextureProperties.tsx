import { useRef, useCallback } from 'react'
import { useStore } from '@/store/store'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { PropertyField } from './PropertyField'
import { TexturePicker } from './TexturePicker'
import { SliderInput } from '@/components/inputs/SliderInput'
import { NumberInput } from '@/components/inputs/NumberInput'
import { ColorField } from '@/components/inputs/ColorField'
import { UpdateChildCommand, CompositeCommand, LayerStyleChangeCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { Layers } from 'lucide-react'
import type { DungeonLayer, ShapeChild } from '@/store/types'

interface ShapeTexturePropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

type TexturePatch = Partial<Pick<ShapeChild,
  'textureId' | 'textureScale' | 'textureOffsetX' | 'textureOffsetY' | 'textureFillRotation' | 'textureTint'
>>

const DEFAULTS = {
  textureScale: 0.25,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
}

/** Wrapper that fires commit on blur with start value captured on focus */
function CommittableNumberInput({
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  onCommit: (after: number, before: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  const startRef = useRef(value)
  return (
    <div
      onFocus={() => { startRef.current = value }}
      onBlur={() => { if (value !== startRef.current) onCommit(value, startRef.current) }}
    >
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full"
      />
    </div>
  )
}

export function ShapeTextureProperties({
  layer,
  openSections,
  onToggleSection,
}: ShapeTexturePropertiesProps) {
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape')

  // Read display values from the first shape, falling back to defaults
  const ref = shapes[0]
  const displayTextureId = layer.style.defaultTextureId ?? ref?.textureId
  const displayScale = ref?.textureScale ?? DEFAULTS.textureScale
  const displayOffsetX = ref?.textureOffsetX ?? DEFAULTS.textureOffsetX
  const displayOffsetY = ref?.textureOffsetY ?? DEFAULTS.textureOffsetY
  const displayRotation = ref?.textureFillRotation ?? DEFAULTS.textureFillRotation
  const displayTint = ref?.textureTint ?? DEFAULTS.textureTint

  const hasTexture = !!displayTextureId
  const noShapes = shapes.length === 0

  /**
   * What each shape held before the current drag started, keyed by child id.
   *
   * `applyLive` overwrites every shape on every tick of a drag, so by the time the
   * commit fires the old values are gone from the store. Captured once at the head
   * of an interaction, they let the commit hand undo each shape its OWN previous
   * value — the widgets only know the one value the panel was displaying, which is
   * the first shape's, and using that for all of them flattened per-shape textures
   * on undo.
   */
  const priorRef = useRef<Map<string, TexturePatch> | null>(null)

  // Live-update all shapes. Deliberately undo-free: this runs per drag tick, and
  // an entry per tick would bury the stack. `commitAll` records the one entry.
  const applyLive = useCallback((patch: TexturePatch) => {
    const keys = Object.keys(patch) as (keyof TexturePatch)[]
    if (!priorRef.current) {
      const current = useStore.getState().layers.find((l) => l.id === layer.id) as
        | DungeonLayer
        | undefined
      const prior = new Map<string, TexturePatch>()
      for (const c of current?.children ?? []) {
        if (c.childType !== 'shape') continue
        const snap: TexturePatch = {}
        for (const k of keys) snap[k] = (c as ShapeChild)[k] as never
        prior.set(c.id, snap)
      }
      priorRef.current = prior
    }
    useStore.setState((state) => {
      const l = state.layers.find((l) => l.id === layer.id) as DungeonLayer | undefined
      if (!l) return
      l.children.forEach((c) => {
        if (c.childType === 'shape') Object.assign(c, patch)
      })
    })
  }, [layer.id])

  /** One undo entry for a finished interaction, restoring each shape's own value. */
  const commitAll = useCallback((after: TexturePatch, fallbackBefore: TexturePatch, label: string) => {
    const prior = priorRef.current
    priorRef.current = null
    const current = useStore.getState().layers.find((l) => l.id === layer.id) as
      | DungeonLayer
      | undefined
    const shapes = (current?.children ?? []).filter(
      (c): c is ShapeChild => c.childType === 'shape',
    )
    if (shapes.length === 0) return
    const cmds = shapes.map(
      // No snapshot means the value was committed without a live drag, so nothing
      // moved and the widget's own before-value is already right.
      (s) => new UpdateChildCommand(label, layer.id, s.id, prior?.get(s.id) ?? fallbackBefore, after),
    )
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds))
  }, [layer.id])

  function handleTextureChange(textureId: string | undefined) {
    // The layer default and every shape move together in ONE undo entry. The layer
    // write used to go straight through `updateLayer`, outside the undo system, so
    // undoing a texture change restored the shapes and left the layer still
    // pointing at the new texture — and the next shape drawn inherited it.
    const cmds = [
      new LayerStyleChangeCommand(
        'Set Texture',
        layer.id,
        'defaultTextureId',
        layer.style.defaultTextureId,
        textureId,
      ),
      ...shapes.map(
        (s) => new UpdateChildCommand(
          'Set Texture',
          layer.id,
          s.id,
          { textureId: s.textureId },
          { textureId },
        ),
      ),
    ]
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Set Texture', cmds))
  }

  return (
    <CollapsibleSection
      id="texture-fill"
      title="Texture Fill"
      icon={Layers}
      defaultOpen={false}
      isOpen={openSections?.has('texture-fill')}
      onToggle={onToggleSection}
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Texture">
          <TexturePicker value={displayTextureId} onChange={handleTextureChange} />
        </PropertyField>

        {hasTexture && (
          <>
            <PropertyField label="Scale">
              <SliderInput
                value={displayScale}
                onChange={(v) => applyLive({ textureScale: v })}
                onChangeCommit={(after, before) =>
                  commitAll({ textureScale: after }, { textureScale: before }, 'Set Texture Scale')
                }
                min={0.25}
                max={4.0}
                step={0.05}
              />
            </PropertyField>

            <div className="flex gap-2">
              <div className="flex-1">
                <PropertyField label="Offset X">
                  <CommittableNumberInput
                    value={displayOffsetX}
                    onChange={(v) => applyLive({ textureOffsetX: v })}
                    onCommit={(after, before) =>
                      commitAll({ textureOffsetX: after }, { textureOffsetX: before }, 'Set Texture Offset X')
                    }
                    step={0.5}
                    disabled={noShapes}
                  />
                </PropertyField>
              </div>
              <div className="flex-1">
                <PropertyField label="Offset Y">
                  <CommittableNumberInput
                    value={displayOffsetY}
                    onChange={(v) => applyLive({ textureOffsetY: v })}
                    onCommit={(after, before) =>
                      commitAll({ textureOffsetY: after }, { textureOffsetY: before }, 'Set Texture Offset Y')
                    }
                    step={0.5}
                    disabled={noShapes}
                  />
                </PropertyField>
              </div>
            </div>

            <PropertyField label="Rotation">
              <CommittableNumberInput
                value={displayRotation}
                onChange={(v) => applyLive({ textureFillRotation: v })}
                onCommit={(after, before) =>
                  commitAll({ textureFillRotation: after }, { textureFillRotation: before }, 'Set Texture Rotation')
                }
                min={0}
                max={360}
                step={1}
                disabled={noShapes}
              />
            </PropertyField>

            <PropertyField label="Tint">
              <ColorField
                value={displayTint}
                onChange={(c) => applyLive({ textureTint: c })}
                onChangeCommit={(newColor, startColor) =>
                  commitAll({ textureTint: newColor }, { textureTint: startColor }, 'Set Texture Tint')
                }
              />
            </PropertyField>
          </>
        )}

        {noShapes && !hasTexture && (
          <p className="text-[10px] font-mono text-text-muted">
            Draw floor shapes to apply textures.
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
