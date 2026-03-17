import { useRef, useCallback } from 'react'
import { useStore } from '@/store/store'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { PropertyField } from './PropertyField'
import { TexturePicker } from './TexturePicker'
import { SliderInput } from '@/components/inputs/SliderInput'
import { NumberInput } from '@/components/inputs/NumberInput'
import { ColorField } from '@/components/inputs/ColorField'
import { ShapeTextureCommand, CompositeCommand, ChangePropertyCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { Layers } from 'lucide-react'
import type { DungeonLayer, ShapeRecord } from '@/store/types'

interface ShapeTexturePropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

type TexturePatch = Partial<Pick<ShapeRecord,
  'textureId' | 'textureScale' | 'textureOffsetX' | 'textureOffsetY' | 'textureFillRotation' | 'textureTint'
>>

const DEFAULTS = {
  textureScale: 0.25,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
}

function commitToAllShapes(layer: DungeonLayer, after: TexturePatch, before: TexturePatch, label: string) {
  if (layer.shapes.length === 0) return
  const cmds = layer.shapes.map(
    (s) => new ShapeTextureCommand(layer.id, s.id, before, after, label),
  )
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds))
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
  const updateLayer = useStore((s) => s.updateLayer)
  const shapes = layer.shapes

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

  // Live-update all shapes without undo (for drag preview)
  const applyLive = useCallback((patch: TexturePatch) => {
    useStore.setState((state) => {
      const l = state.layers.find((l) => l.id === layer.id) as DungeonLayer | undefined
      l?.shapes.forEach((s) => Object.assign(s, patch))
    })
  }, [layer.id])

  function handleTextureChange(textureId: string | undefined) {
    const oldDefaultId = layer.style.defaultTextureId
    const styleCmd = new ChangePropertyCommand(
      'Set Default Texture',
      oldDefaultId,
      textureId,
      (val) => updateLayer(layer.id, {
        style: { ...layer.style, defaultTextureId: val },
      } as Partial<DungeonLayer>),
    )
    if (shapes.length > 0) {
      const shapeCmds = layer.shapes.map(
        (s) => new ShapeTextureCommand(layer.id, s.id, { textureId: s.textureId }, { textureId }, 'Set Texture'),
      )
      undoManager.execute(new CompositeCommand('Set Texture', [styleCmd, ...shapeCmds]))
    } else {
      undoManager.execute(styleCmd)
    }
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
                  commitToAllShapes(layer, { textureScale: after }, { textureScale: before }, 'Set Texture Scale')
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
                      commitToAllShapes(layer, { textureOffsetX: after }, { textureOffsetX: before }, 'Set Texture Offset X')
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
                      commitToAllShapes(layer, { textureOffsetY: after }, { textureOffsetY: before }, 'Set Texture Offset Y')
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
                  commitToAllShapes(layer, { textureFillRotation: after }, { textureFillRotation: before }, 'Set Texture Rotation')
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
                  commitToAllShapes(layer, { textureTint: newColor }, { textureTint: startColor }, 'Set Texture Tint')
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
