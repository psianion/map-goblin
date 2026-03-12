import { useStore } from '@/store/store'
import type { DungeonLayer, DungeonStyle } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { NumberInput } from '@/components/inputs/NumberInput'

interface LayerPropertiesProps {
  layer: DungeonLayer
}

const HATCHING_STYLES = ['none', 'crosshatch', 'lines', 'horizontal'] as const

export function LayerProperties({ layer }: LayerPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)

  function patch(partial: Partial<DungeonStyle>) {
    updateLayer(layer.id, { style: { ...layer.style, ...partial } } as Partial<DungeonLayer>)
  }

  const s = layer.style

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
        Layer
      </span>

      {/* ── Colors ── */}
      <PropertyField label="Floor Color">
        <ColorField value={s.floorColor} onChange={(c) => patch({ floorColor: c })} />
      </PropertyField>

      <PropertyField label="Wall Color">
        <ColorField value={s.wallColor} onChange={(c) => patch({ wallColor: c })} />
      </PropertyField>

      <PropertyField label="Wall Width">
        <SliderInput
          value={s.wallWidth}
          onChange={(v) => patch({ wallWidth: v })}
          min={0.05}
          max={1}
          step={0.05}
        />
      </PropertyField>

      {/* ── Shadow ── */}
      <PropertyField label="Shadow">
        <label className="flex items-center gap-2 text-panel-body text-text-primary">
          <input
            type="checkbox"
            checked={s.shadowEnabled}
            onChange={(e) => patch({ shadowEnabled: e.target.checked })}
            className="accent-accent"
          />
          Enabled
        </label>
      </PropertyField>

      {s.shadowEnabled && (
        <>
          <PropertyField label="Shadow Color">
            <ColorField value={s.shadowColor} onChange={(c) => patch({ shadowColor: c })} />
          </PropertyField>

          <PropertyField label="Shadow Intensity">
            <SliderInput
              value={s.shadowIntensity}
              onChange={(v) => patch({ shadowIntensity: v })}
              min={0}
              max={1}
              step={0.05}
            />
          </PropertyField>

          <PropertyField label="Shadow Offset">
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
        </>
      )}

      {/* ── Hatching ── */}
      <PropertyField label="Hatching Style">
        <select
          value={s.hatchingStyle}
          onChange={(e) =>
            patch({ hatchingStyle: e.target.value as DungeonStyle['hatchingStyle'] })
          }
          className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
        >
          {HATCHING_STYLES.map((style) => (
            <option key={style} value={style}>
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </option>
          ))}
        </select>
      </PropertyField>

      {s.hatchingStyle !== 'none' && (
        <>
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
            <label className="flex items-center gap-2 text-panel-body text-text-primary">
              <input
                type="checkbox"
                checked={s.hatchingInverted}
                onChange={(e) => patch({ hatchingInverted: e.target.checked })}
                className="accent-accent"
              />
              Invert hatching
            </label>
          </PropertyField>
        </>
      )}

      {/* ── Roughness ── */}
      <PropertyField label="Roughness">
        <SliderInput
          value={s.roughnessAmplitude}
          onChange={(v) => patch({ roughnessAmplitude: v })}
          min={0}
          max={0.5}
          step={0.01}
        />
      </PropertyField>
    </div>
  )
}
