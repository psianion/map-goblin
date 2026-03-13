import { useStore } from '@/store/store'
import type { Light } from '@/store/types'
import { PropertyField } from './PropertyField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { ColorField } from '@/components/inputs/ColorField'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { cn } from '@/lib/utils'
import { Sun, X } from 'lucide-react'
import { ChangePropertyCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'

interface LightPropertiesProps {
  light: Light
  onDeselect?: () => void
}

/** Convert a world-unit radius to a rounded feet string using the map's cell scale. */
function toFt(worldUnits: number, ftPerCell: number): string {
  return `${Math.round(worldUnits * ftPerCell)} ft`
}

// Slider bounds in feet — world-unit equivalents are derived at render time.
const MIN_RADIUS_FT = 5
const MAX_RADIUS_FT = 300

export function LightProperties({ light, onDeselect }: LightPropertiesProps) {
  const updateLight = useStore((s) => s.updateLight)
  const cellScale = useStore((s) => s.mapSettings.cellScale)
  const ftPerCell = cellScale.value

  // Convert ft bounds to world units for the slider
  const minRadius = MIN_RADIUS_FT / ftPerCell
  const maxRadius = MAX_RADIUS_FT / ftPerCell

  const featherRadius = light.featherRadius ?? 0

  return (
    <CollapsibleSection
      id="light"
      title="Light"
      icon={Sun}
      defaultOpen={true}
      preview={
        <span
          className="w-[14px] h-[14px] rounded-full border border-border-default"
          style={{ backgroundColor: light.color }}
        />
      }
      headerExtra={
        onDeselect ? (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 text-text-muted hover:text-text-primary transition-colors"
            onClick={onDeselect}
            title="Deselect light"
          >
            <X size={12} />
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 pt-2">
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
            onChangeCommit={(newColor, startColor) =>
              undoManager.execute(
                new ChangePropertyCommand('Light color', startColor, newColor, (v) =>
                  updateLight(light.id, { color: v }),
                ),
              )
            }
          />
        </PropertyField>

        {/* Radius — maximum reach of the light */}
        <PropertyField
          label={
            <span className="flex items-center justify-between w-full">
              <span>Radius</span>
              <span className="text-text-muted text-[10px] font-normal">
                {toFt(light.radius, ftPerCell)}
              </span>
            </span>
          }
        >
          <div data-testid="light-radius-slider">
            <SliderInput
              value={light.radius}
              onChange={(v) => {
                // Keep featherRadius ≤ new radius
                const updates: Partial<Light> = { radius: v }
                if (featherRadius > v) updates.featherRadius = v
                updateLight(light.id, updates)
              }}
              onChangeCommit={(newVal, startVal) =>
                undoManager.execute(
                  new ChangePropertyCommand('Light radius', startVal, newVal, (v) =>
                    updateLight(light.id, { radius: v }),
                  ),
                )
              }
              min={minRadius}
              max={maxRadius}
              step={minRadius}
            />
          </div>
        </PropertyField>

        {/* Bright zone — percentage of radius at full brightness */}
        <PropertyField
          label={
            <span className="flex items-center justify-between w-full">
              <span>Bright Zone</span>
              <span className="text-text-muted text-[10px] font-normal">
                {light.radius > 0 ? Math.round((featherRadius / light.radius) * 100) : 0}%
              </span>
            </span>
          }
        >
          <div data-testid="light-feather-slider">
            <SliderInput
              value={light.radius > 0 ? Math.round((featherRadius / light.radius) * 100) : 0}
              onChange={(pct) =>
                updateLight(light.id, { featherRadius: (pct / 100) * light.radius })
              }
              onChangeCommit={(newPct, startPct) =>
                undoManager.execute(
                  new ChangePropertyCommand('Light bright zone', startPct, newPct, (pct) =>
                    updateLight(light.id, { featherRadius: (pct / 100) * light.radius }),
                  ),
                )
              }
              min={0}
              max={100}
              step={5}
            />
          </div>
        </PropertyField>

        <PropertyField label="Intensity">
          <div data-testid="light-intensity-slider">
            <SliderInput
              value={light.intensity}
              onChange={(v) => updateLight(light.id, { intensity: v })}
              onChangeCommit={(newVal, startVal) =>
                undoManager.execute(
                  new ChangePropertyCommand('Light intensity', startVal, newVal, (v) =>
                    updateLight(light.id, { intensity: v }),
                  ),
                )
              }
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
              onClick={() =>
                undoManager.execute(
                  new ChangePropertyCommand<'linear' | 'quadratic'>(
                    'Light falloff',
                    light.falloff,
                    'linear',
                    (v) => updateLight(light.id, { falloff: v }),
                  ),
                )
              }
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
              onClick={() =>
                undoManager.execute(
                  new ChangePropertyCommand<'linear' | 'quadratic'>(
                    'Light falloff',
                    light.falloff,
                    'quadratic',
                    (v) => updateLight(light.id, { falloff: v }),
                  ),
                )
              }
            >
              Quadratic
            </button>
          </div>
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
