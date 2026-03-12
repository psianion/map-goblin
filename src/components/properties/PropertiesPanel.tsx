import { useStore } from '@/store/store'
import { selectActiveLayer } from '@/store/selectors'
import { LayerProperties } from './LayerProperties'
import { BackgroundProperties } from './BackgroundProperties'
import { LightProperties } from './LightProperties'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import type { DungeonLayer, BackgroundLayer } from '@/store/types'

export function PropertiesPanel() {
  const activeLayer = useStore(selectActiveLayer)
  const lights = useStore((s) => s.lights)
  const selectedObjectIds = useStore((s) => s.ui.selectedObjectIds)
  const ambientLight = useStore((s) => s.mapSettings.ambientLight)

  // Check if first selected ID refers to a light
  const firstSelectedId = selectedObjectIds[0]
  const selectedLight = firstSelectedId
    ? lights.find((l) => l.id === firstSelectedId)
    : undefined

  if (selectedLight) {
    return (
      <div className="flex flex-col">
        <LightProperties
          light={selectedLight}
          onDeselect={() => useStore.getState().setSelectedObjectIds([])}
        />
        <hr className="border-border-subtle mx-2" />
        <div className="flex flex-col gap-3 p-3">
          <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
            Ambient
          </span>
          <PropertyField label="Ambient Color">
            <div data-testid="ambient-color-swatch">
              <ColorField
                value={ambientLight}
                onChange={(c) => useStore.getState().setAmbientLight(c)}
              />
            </div>
          </PropertyField>
        </div>
      </div>
    )
  }

  if (!activeLayer) {
    return (
      <div className="flex flex-col">
        <div className="p-3 text-panel-body text-text-muted">
          No layer selected
        </div>
        <hr className="border-border-subtle mx-2" />
        <div className="flex flex-col gap-3 p-3">
          <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
            Ambient
          </span>
          <PropertyField label="Ambient Color">
            <div data-testid="ambient-color-swatch">
              <ColorField
                value={ambientLight}
                onChange={(c) => useStore.getState().setAmbientLight(c)}
              />
            </div>
          </PropertyField>
        </div>
      </div>
    )
  }

  if (activeLayer.type === 'dungeon') {
    return (
      <div className="flex flex-col">
        <LayerProperties layer={activeLayer as DungeonLayer} />
        <hr className="border-border-subtle mx-2" />
        <div className="flex flex-col gap-3 p-3">
          <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
            Ambient
          </span>
          <PropertyField label="Ambient Color">
            <div data-testid="ambient-color-swatch">
              <ColorField
                value={ambientLight}
                onChange={(c) => useStore.getState().setAmbientLight(c)}
              />
            </div>
          </PropertyField>
        </div>
      </div>
    )
  }

  if (activeLayer.type === 'background') {
    return (
      <div className="flex flex-col">
        <BackgroundProperties layer={activeLayer as BackgroundLayer} />
        <hr className="border-border-subtle mx-2" />
        <div className="flex flex-col gap-3 p-3">
          <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
            Ambient
          </span>
          <PropertyField label="Ambient Color">
            <div data-testid="ambient-color-swatch">
              <ColorField
                value={ambientLight}
                onChange={(c) => useStore.getState().setAmbientLight(c)}
              />
            </div>
          </PropertyField>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="p-3 text-panel-body text-text-muted">
        No properties for this layer type
      </div>
      <hr className="border-border-subtle mx-2" />
      <div className="flex flex-col gap-3 p-3">
        <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
          Ambient
        </span>
        <PropertyField label="Ambient Color">
          <div data-testid="ambient-color-swatch">
            <ColorField
              value={ambientLight}
              onChange={(c) => useStore.getState().setAmbientLight(c)}
            />
          </div>
        </PropertyField>
      </div>
    </div>
  )
}
