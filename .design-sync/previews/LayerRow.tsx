import { LayerRow, useStore } from 'map-builder';

// One row of the layer tree. Uses the real layers already in the store rather
// than a fabricated Layer, so the row reflects the actual schema.
const layers = useStore.getState().layers;
const dungeon = layers.find((l) => l.type !== 'background')!;
const background = layers.find((l) => l.type === 'background')!;

export function Active() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <LayerRow layer={dungeon} isActive posInSet={1} setSize={2} />
    </div>
  );
}

export function Inactive() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <LayerRow layer={background} isActive={false} posInSet={2} setSize={2} />
    </div>
  );
}

export function Stacked() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <LayerRow layer={dungeon} isActive posInSet={1} setSize={2} />
      <LayerRow layer={background} isActive={false} posInSet={2} setSize={2} />
    </div>
  );
}
