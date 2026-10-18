import { ZoneProperties, useStore } from 'map-builder';

// Zones are rectangular regions a DM tags for prep (encounters, room notes).
// Seeded through the store so ZoneProperties resolves it by id the same way
// the app does.
const store = useStore.getState();
const layer = store.layers.find((l) => l.type !== 'background')!;

const zone = {
  id: 'preview-zone-1',
  name: 'Ambush hollow',
  childType: 'zone' as const,
  visible: true,
  shape: { kind: 'rect' as const, x: 160, y: 160, width: 320, height: 200 },
};

store.addChild(layer.id, zone);

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <ZoneProperties layerId={layer.id} childId={zone.id} />
    </div>
  );
}
