import { TerrainProperties } from 'map-builder';

const noop = () => {};

// Section id is "terrain" and defaultOpen is true, so passing an explicit open
// set renders identically to the default — the meaningful second story is the
// collapsed state.
export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TerrainProperties />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TerrainProperties openSections={new Set()} onToggleSection={noop} />
    </div>
  );
}
