import { useStore } from '@/store/store'
import type { Light } from '@/store/types'
import { PropertyField } from './PropertyField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { ColorField } from '@/components/inputs/ColorField'
import { cn } from '@/lib/utils'

interface LightPropertiesProps {
  light: Light
}

export function LightProperties({ light }: LightPropertiesProps) {
  const updateLight = useStore((s) => s.updateLight)

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
        Light
      </span>

      <PropertyField label="Name">
        <input
          value={light.name}
          onChange={(e) => updateLight(light.id, { name: e.target.value })}
          className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
        />
      </PropertyField>

      <PropertyField label="Color">
        <ColorField
          value={light.color}
          onChange={(c) => updateLight(light.id, { color: c })}
        />
      </PropertyField>

      <PropertyField label="Radius">
        <div data-testid="light-radius-slider">
          <SliderInput
            value={light.radius}
            onChange={(v) => updateLight(light.id, { radius: v })}
            min={20}
            max={800}
            step={1}
          />
        </div>
      </PropertyField>

      <PropertyField label="Intensity">
        <div data-testid="light-intensity-slider">
          <SliderInput
            value={light.intensity}
            onChange={(v) => updateLight(light.id, { intensity: v })}
            min={0}
            max={1}
            step={0.01}
          />
        </div>
      </PropertyField>

      <PropertyField label="Falloff">
        <div className="flex gap-1">
          <button
            className={cn(
              'flex-1 h-7 text-panel-small rounded border transition-colors',
              light.falloff === 'linear'
                ? 'bg-surface-3 border-border-focus text-text-primary'
                : 'bg-surface-2 border-border-default text-text-secondary hover:bg-surface-3',
            )}
            onClick={() => updateLight(light.id, { falloff: 'linear' })}
          >
            Linear
          </button>
          <button
            className={cn(
              'flex-1 h-7 text-panel-small rounded border transition-colors',
              light.falloff === 'quadratic'
                ? 'bg-surface-3 border-border-focus text-text-primary'
                : 'bg-surface-2 border-border-default text-text-secondary hover:bg-surface-3',
            )}
            onClick={() => updateLight(light.id, { falloff: 'quadratic' })}
          >
            Quadratic
          </button>
        </div>
      </PropertyField>
    </div>
  )
}
