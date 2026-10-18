import { DoorProperties, useStore } from 'map-builder';

// A door belongs to a wall, so the preview seeds both through the store's own
// actions and then hands DoorProperties the ids it expects.
const store = useStore.getState();
const layer = store.layers.find((l) => l.type !== 'background')!;

const wall = {
  id: 'preview-door-wall',
  points: [
    [120, 120],
    [520, 120],
  ] as [number, number][],
  wallType: 'normal' as const,
  direction: 'both' as const,
  color: '#5c5f57',
  width: 12,
  roughness: 0.35,
};

const door = {
  id: 'preview-door-1',
  name: 'Oak door',
  childType: 'door' as const,
  visible: true,
  wallId: wall.id,
  position: [320, 120] as [number, number],
  angle: 0,
  width: 64,
  style: 'single' as const,
};

store.addWall(layer.id, wall);
store.addChild(layer.id, door);

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <DoorProperties layerId={layer.id} childId={door.id} />
    </div>
  );
}
