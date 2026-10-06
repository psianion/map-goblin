import { ShapeTextureProperties, useStore } from 'map-builder';

const noop = () => {};
const dungeonLayer = useStore.getState().layers.find((l) => l.type !== 'background')!;

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <ShapeTextureProperties layer={dungeonLayer} />
    </div>
  );
}

export function SectionsOpen() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <ShapeTextureProperties
        layer={dungeonLayer}
        openSections={new Set(['texture-fill'])}
        onToggleSection={noop}
      />
    </div>
  );
}
