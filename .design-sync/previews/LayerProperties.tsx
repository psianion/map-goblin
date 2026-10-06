import { LayerProperties, useStore } from 'map-builder';

const noop = () => {};

// Uses the real dungeon layer out of the store rather than a fabricated
// look-alike, so the panel reflects the actual Layer schema.
const dungeonLayer = useStore.getState().layers.find((l) => l.type !== 'background')!;

export function Default() {
  return (
    <div className="h-[560px] w-[320px] overflow-hidden rounded-lg border border-border">
      <LayerProperties layer={dungeonLayer} />
    </div>
  );
}

export function SectionsOpen() {
  return (
    <div className="h-[560px] w-[320px] overflow-hidden rounded-lg border border-border">
      <LayerProperties
        layer={dungeonLayer}
        openSections={new Set(['layer', 'sublayers', 'colors'])}
        onToggleSection={noop}
      />
    </div>
  );
}
