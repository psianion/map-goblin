import { useState } from 'react'
import { useStore } from '@/store/store'
import type { DungeonLayer, DungeonStyle } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { SliderInput } from '@/components/inputs/SliderInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Palette, Minus, Grid3x3, Waves, Blend, Sparkles } from 'lucide-react'
import { getWallSetDefaults, type WallCategory } from '@/assets/textureManifest'
import { PresetStrip } from '@/components/shared/PresetStrip'
import { DUNGEON_STYLE_PRESETS } from '@/store/presetRegistry'

interface LayerPropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

const HATCHING_STYLES_ACTIVE = ['crosshatch', 'lines', 'horizontal'] as const

const DUNGEON_PRESET_CHIPS = DUNGEON_STYLE_PRESETS.map((p) => ({
  id: p.id,
  label: p.label,
  color: p.dungeonStyle.floorColor,
}))

export function LayerProperties({ layer, openSections, onToggleSection }: LayerPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)
  const [activePresetId, setActivePresetId] = useState<string | undefined>()

  function patch(partial: Partial<DungeonStyle>) {
    updateLayer(layer.id, { style: { ...layer.style, ...partial } } as Partial<DungeonLayer>)
  }

  const handleStylePreset = (id: string) => {
    const preset = DUNGEON_STYLE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setActivePresetId(id)
    patch(preset.dungeonStyle)
  }

  const s = layer.style
  const hatchingEnabled = s.hatchingStyle !== 'none'

  return (
    <div className="flex flex-col pt-2">
      {/* ── Style Presets ── */}
      <CollapsibleSection
        id="style-presets"
        title="Style Presets"
        icon={Sparkles}
        defaultOpen={true}
        isOpen={openSections?.has('style-presets')}
        onToggle={onToggleSection}
      >
        <div className="pt-2">
          <PresetStrip
            presets={DUNGEON_PRESET_CHIPS}
            activeId={activePresetId}
            onSelect={handleStylePreset}
          />
        </div>
      </CollapsibleSection>

      {/* ── Colors ── */}
      <CollapsibleSection
        id="colors"
        title="Colors"
        icon={Palette}
        defaultOpen={true}
        isOpen={openSections?.has('colors')}
        onToggle={onToggleSection}
        preview={
          <div className="flex gap-2">
            <ColorChip color={s.floorColor} size="preview" />
          </div>
        }
      >
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField label="Floor Color">
            <ColorField value={s.floorColor} onChange={(c) => patch({ floorColor: c })} />
          </PropertyField>
        </div>
      </CollapsibleSection>

      {/* ── Walls ── */}
      <CollapsibleSection id="walls" title="Walls" icon={Minus} defaultOpen={false} isOpen={openSections?.has('walls')} onToggle={onToggleSection}>
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField label="Wall Texture">
            <select
              value={s.wallTextureSetId ?? 'none'}
              onChange={(e) => {
                const val = e.target.value === 'none' ? undefined : e.target.value
                if (val) {
                  const defaults = getWallSetDefaults(val as WallCategory)
                  patch({ wallTextureSetId: val, wallWidth: defaults.defaultWidth })
                } else {
                  patch({ wallTextureSetId: val })
                }
              }}
              className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
            >
              <option value="none">None (Invisible)</option>
              <option value="stone-slate">Stone Slate</option>
              <option value="wood-ashen">Wood Ashen</option>
            </select>
          </PropertyField>

          {s.wallTextureSetId && (() => {
            const wd = getWallSetDefaults(s.wallTextureSetId as WallCategory)
            return (
              <>
                <PropertyField label="Wall Width">
                  <SliderInput
                    value={s.wallWidth}
                    onChange={(v) => patch({ wallWidth: v })}
                    min={wd.minWidth}
                    max={wd.maxWidth}
                    step={0.05}
                  />
                </PropertyField>
                <PropertyField label="Wall Tint">
                  <ColorField
                    value={s.wallTextureTint}
                    onChange={(c) => patch({ wallTextureTint: c })}
                  />
                </PropertyField>
              </>
            )
          })()}
        </div>
      </CollapsibleSection>

      {/* ── Hatching ── */}
      <CollapsibleSection
        id="hatching"
        title="Hatching"
        icon={Grid3x3}
        defaultOpen={false}
        isOpen={openSections?.has('hatching')}
        onToggle={onToggleSection}
        headerExtra={
          <ToggleSwitch
            checked={hatchingEnabled}
            onChange={(v) => patch({ hatchingStyle: v ? 'lines' : 'none' })}
            label="Enable hatching"
          />
        }
      >
        {hatchingEnabled ? (
          <div className="flex flex-col gap-2 pt-2">
            <PropertyField label="Style">
              <select
                value={s.hatchingStyle}
                onChange={(e) =>
                  patch({ hatchingStyle: e.target.value as DungeonStyle['hatchingStyle'] })
                }
                className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
              >
                {HATCHING_STYLES_ACTIVE.map((style) => (
                  <option key={style} value={style}>
                    {style.charAt(0).toUpperCase() + style.slice(1)}
                  </option>
                ))}
              </select>
            </PropertyField>
            <PropertyField label="Band Width">
              <SliderInput
                value={s.hatchingBandWidth}
                onChange={(v) => patch({ hatchingBandWidth: v })}
                min={0.1}
                max={2}
                step={0.1}
              />
            </PropertyField>
            <PropertyField label="Line Spacing">
              <SliderInput
                value={s.hatchingLineSpacing}
                onChange={(v) => patch({ hatchingLineSpacing: v })}
                min={0.05}
                max={1}
                step={0.05}
              />
            </PropertyField>
            <PropertyField label="Line Thickness">
              <SliderInput
                value={s.hatchingLineThickness}
                onChange={(v) => patch({ hatchingLineThickness: v })}
                min={0.01}
                max={0.2}
                step={0.01}
              />
            </PropertyField>
            <PropertyField label="Angle">
              <SliderInput
                value={s.hatchingAngle}
                onChange={(v) => patch({ hatchingAngle: v })}
                min={0}
                max={Math.PI}
                step={0.05}
              />
            </PropertyField>
            <PropertyField label="Inverted">
              <ToggleSwitch
                checked={s.hatchingInverted}
                onChange={(v) => patch({ hatchingInverted: v })}
                label="Invert hatching"
              />
            </PropertyField>
          </div>
        ) : (
          <p className="text-panel-label text-text-muted pt-2">Hatching is disabled.</p>
        )}
      </CollapsibleSection>

      {/* ── Edge Transitions ── */}
      <CollapsibleSection
        id="edgeTransitions"
        title="Edge Transitions"
        icon={Blend}
        defaultOpen={false}
        isOpen={openSections?.has('edgeTransitions')}
        onToggle={onToggleSection}
        headerExtra={
          <ToggleSwitch
            checked={s.showEdgeTransitions}
            onChange={(v) => patch({ showEdgeTransitions: v })}
            label="Enable edge transitions"
          />
        }
      >
        {s.showEdgeTransitions ? (
          <div className="flex flex-col gap-2 pt-2">
            <PropertyField label="Transition Width">
              <SliderInput
                value={s.edgeTransitionWidth}
                onChange={(v) => patch({ edgeTransitionWidth: v })}
                min={0.05}
                max={2}
                step={0.05}
              />
            </PropertyField>
          </div>
        ) : (
          <p className="text-panel-label text-text-muted pt-2">Edge transitions are disabled.</p>
        )}
      </CollapsibleSection>

      {/* ── Roughness ── */}
      <CollapsibleSection id="rough" title="Roughness" icon={Waves} defaultOpen={false} isOpen={openSections?.has('rough')} onToggle={onToggleSection}>
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField label="Amplitude">
            <SliderInput
              value={s.roughnessAmplitude}
              onChange={(v) => patch({ roughnessAmplitude: v })}
              min={0}
              max={0.5}
              step={0.01}
            />
          </PropertyField>
        </div>
      </CollapsibleSection>
    </div>
  )
}
