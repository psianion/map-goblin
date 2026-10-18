import { WallProperties, useStore } from 'map-builder';

// WallProperties takes ids and looks the wall up in the store, so the preview
// seeds one real WallSegment through the store's own addWall action rather
// than mocking the lookup. Synchronous zustand set — settled before render.
const store = useStore.getState();
const layer = store.layers.find((l) => l.type !== 'background')!;

const wall = {
  id: 'preview-wall-1',
  points: [
    [120, 120],
    [520, 120],
    [520, 360],
  ] as [number, number][],
  wallType: 'normal' as const,
  direction: 'both' as const,
  color: '#5c5f57',
  width: 12,
  roughness: 0.35,
};

store.addWall(layer.id, wall);

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <WallProperties layerId={layer.id} wallId={wall.id} />
    </div>
  );
}
