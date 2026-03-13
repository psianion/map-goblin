import { useStore } from '@/store/store'
import type { DungeonLayer, DungeonStyle } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { NumberInput } from '@/components/inputs/NumberInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Palette, Minus, Sun, Grid3x3, Waves } from 'lucide-react'

interface LayerPropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

const HATCHING_STYLES_ACTIVE = ['crosshatch', 'lines', 'horizontal'] as const

export function LayerProperties({ layer, openSections, onToggleSection }: LayerPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)

  function patch(partial: Partial<DungeonStyle>) {
    updateLayer(layer.id, { style: { ...layer.style, ...partial } } as Partial<DungeonLayer>)
  }

  const s = layer.style
  const hatchingEnabled = s.hatchingStyle !== 'none'

  return (
    <div className="flex flex-col pt-2">
      {/* ── Colors ── */}
      <CollapsibleSection
        id="colors"
        title="Colors"
        icon={Palette}
        defaultOpen={true}
        isOpen={openSections?.has('colors')}
        onToggle={onToggleSection}
        preview={
          <div className="flex gap-1">
            <span
              className="w-[22px] h-[14px] rounded-[2px] border border-border-default"
              style={{ backgroundColor: s.floorColor }}
            />
            <span
              className="w-[22px] h-[14px] rounded-[2px] border border-border-default"
              style={{ backgroundColor: s.wallColor }}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField label="Floor Color">
            <ColorField value={s.floorColor} onChange={(c) => patch({ floorColor: c })} />
          </PropertyField>
          <PropertyField label="Wall Color">
            <ColorField value={s.wallColor} onChange={(c) => patch({ wallColor: c })} />
          </PropertyField>
        </div>
      </CollapsibleSection>

      {/* ── Walls ── */}
      <CollapsibleSection id="walls" title="Walls" icon={Minus} defaultOpen={false} isOpen={openSections?.has('walls')} onToggle={onToggleSection}>
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField label="Wall Width">
            <SliderInput
              value={s.wallWidth}
              onChange={(v) => patch({ wallWidth: v })}
              min={0.05}
              max={1}
              step={0.05}
            />
          </PropertyField>
        </div>
      </CollapsibleSection>

      {/* ── Shadow ── */}
      <CollapsibleSection
        id="shadow"
        title="Shadow"
        icon={Sun}
        defaultOpen={false}
        isOpen={openSections?.has('shadow')}
        onToggle={onToggleSection}
        headerExtra={
          <ToggleSwitch
            checked={s.shadowEnabled}
            onChange={(v) => patch({ shadowEnabled: v })}
            label="Enable shadow"
          />
        }
      >
        {s.shadowEnabled ? (
          <div className="flex flex-col gap-2 pt-2">
            <PropertyField label="Shadow Color">
              <ColorField value={s.shadowColor} onChange={(c) => patch({ shadowColor: c })} />
            </PropertyField>
            <PropertyField label="Intensity">
              <SliderInput
                value={s.shadowIntensity}
                onChange={(v) => patch({ shadowIntensity: v })}
                min={0}
                max={1}
                step={0.05}
              />
            </PropertyField>
            <PropertyField label="Offset X / Y">
              <div className="flex gap-1">
                <NumberInput
                  value={s.shadowOffset.x}
                  onChange={(v) => patch({ shadowOffset: { ...s.shadowOffset, x: v } })}
                  step={0.1}
                  className="w-full h-7 text-panel-body"
                />
                <NumberInput
                  value={s.shadowOffset.y}
                  onChange={(v) => patch({ shadowOffset: { ...s.shadowOffset, y: v } })}
                  step={0.1}
                  className="w-full h-7 text-panel-body"
                />
              </div>
            </PropertyField>
          </div>
        ) : (
          <p className="text-panel-label text-text-muted pt-2">Shadow is disabled.</p>
        )}
      </CollapsibleSection>

      {/* ── Hatching ── */}
      <CollapsibleSection
        id="hatching"
        title="Hatching"
        icon={Grid3x3}
        defaultOpen={false}
        isOpen={openSections?.has('hatch')}
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
