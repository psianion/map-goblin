// The plateau card's custom rows, shared with the Elevation dock: Height with its drop,
// Cliff art, a painted border's texture, a slope's face, the Top, the Direction dial, Crossing.
// Each shows the value it is handed and writes through onChange: the card writes every picked
// plateau, the dock's settings write the picked plateaus and the tool (elevation.ts). In the dock
// a picture row is its picked tile, which opens the row, so the columns fit beside each other.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { defaultCrossingId, edgeOf, shapeDrop } from '@dnd/core/src/shared/plateaus';
import { borderTextureChoices, canonicalEdgeArt, cliffArt, cliffArtChoices, defaultBorderTexture, PAINTED_BORDER } from '@dnd/core/src/engine/plateauKit';
import { faceTiles, materialLabel } from '@dnd/core/src/assets/materialKit';
import { SelectRow, SettingRow, Stepper } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { GROUND_FACE, GROUND_TOP, signed, stepHeight } from './plateauModel';
import { DEFAULT_ART, EDGE_CROSSING } from './plateauModel';
import { FaceDial } from './FaceDial';

/** Its level on the stepper, and beside it how far its edge falls. */
export function HeightField({ def, value, onChange }: SettingProps<number>) {
  const where = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const layer = id ? selectLayerForChild(s, id) : undefined;
    return layer && id ? `drop ${Math.abs(shapeDrop(layer, id))}` : '';
  });
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-3" data-testid="design-plateau-standing">
          {where}
        </span>
        <Stepper label={def.label} value={value} format={signed} onValueChange={(v) => onChange(stepHeight(value, Math.sign(v - value)))} />
      </span>
    </SettingRow>
  );
}

/** The cliff sets the packs ship, each pictured by a piece of its ledge; they arrive after boot, so they are read live. */
export function CliffArtField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const swatches = cliffArtChoices().map((c) => ({
    value: c.value ?? DEFAULT_ART,
    label: c.label,
    // A painted border is pictured by the texture it takes until one is picked.
    art: c.value === PAINTED_BORDER ? defaultBorderTexture() : cliffArt(c.value).values().next().value?.id,
  }));
  // A set a pack has since renamed shows as the set it became.
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={canonicalEdgeArt(value) ?? value} onPick={onChange} compact={def.home === 'dock'} />;
}

/** The outdoor floors the Material brush lists, read live; a floor stored that is no longer offered still shows as what it is. */
function floorSwatches(shown: string) {
  const options = borderTextureChoices();
  if (shown && !options.some((o) => o.value === shown)) options.push({ value: shown, label: materialLabel(shown) });
  return options.map((o) => ({ ...o, art: o.value }));
}

/** A painted border's texture: the outdoor floors the Material brush lists, read live as the cliff sets are. */
export function BorderTextureField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={floorSwatches(value)} value={value} onPick={onChange} compact={def.home === 'dock'} />;
}

/**
 * A slope's face texture: Ground (pictured by the map's base ground, when it has one), then
 * every installed face tile; read live, as the cliff sets are.
 */
export function FaceArtField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const groundArt = useStore((s) => s.mapSettings.ground?.textureId);
  const swatches = [{ value: GROUND_FACE, label: 'Ground', art: groundArt }, ...faceTiles().map((t) => ({ value: t.id, label: t.label, art: t.id }))];
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value} onPick={onChange} compact={def.home === 'dock'} />;
}

/**
 * A plateau's top texture: Ground (the top shows what is under it, pictured by the map's base
 * ground), then the outdoor floors the Material brush lists; read live.
 */
export function TopArtField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const groundArt = useStore((s) => s.mapSettings.ground?.textureId);
  const swatches = [{ value: GROUND_TOP, label: 'Ground', art: groundArt }, ...floorSwatches(value === GROUND_TOP ? '' : value)];
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value} onPick={onChange} compact={def.home === 'dock'} />;
}

/** A slope's Direction on the card: the dial alone, showing the plateau's own direction (or, saved without one, the map's). */
export function DirectionField({ def, value, onChange }: SettingProps<number>) {
  return (
    <div data-composite="direction-field" className="flex w-[248px] flex-col gap-1 py-1">
      <span className="text-[12px] text-text-2">{def.label}</span>
      <FaceDial label={def.label} value={value} onChange={onChange} />
    </div>
  );
}

/** The Slope direction on the Elevation dock: the next plateau's, and the picked plateaus'. */
export function SlopeDirectionField({ def, value, onChange }: SettingProps<number>) {
  return <FaceDial label={def.label} value={value} onChange={onChange} />;
}

/** The map's crossing kinds, Default (the edge's own) first. */
export function CrossingField({ def, value, onChange }: SettingProps<string>) {
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  const edgeDefault = useStore((s) => {
    const id = s.selection.selectedIds[0];
    const p = id ? selectLayerForChild(s, id)?.children.find((c) => c.id === id) : undefined;
    return p?.childType === 'plateau' ? defaultCrossingId(edgeOf(p)) : 'free';
  });
  const name = kinds.find((k) => k.id === edgeDefault)?.name ?? 'none';
  const options = [{ value: EDGE_CROSSING, label: `Default (${name})` }, ...kinds.map((k) => ({ value: k.id, label: k.name }))];
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}
