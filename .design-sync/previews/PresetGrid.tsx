import { PresetGrid, DUNGEON_STYLE_PRESETS } from 'map-builder';

const noop = () => {};

// Each tile is a swatch derived from preset.dungeonStyle — the label is only a
// tooltip — so the product's real preset registry is the only thing that makes
// this grid legible. Stub presets render as identical blank tiles.
const presets = DUNGEON_STYLE_PRESETS;

export function Default() {
  return (
    <div className="w-[340px]">
      <PresetGrid presets={presets} activeId={presets[0]?.id} onSelect={noop} />
    </div>
  );
}

export function DifferentSelection() {
  return (
    <div className="w-[340px]">
      <PresetGrid presets={presets} activeId={presets[2]?.id} onSelect={noop} />
    </div>
  );
}
