// The floor card's custom rows: Layer, Colour with Reset, Texture with Change, the Fill fold,
// Edge band with Painted border, and a painted border's texture.

import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { getBandSetIds, getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { outdoorFloorChoices } from '@dnd/core/src/assets/materialKit';
import type { DungeonLayer } from '@/store/types';
import { ColourRow, Fold, SecondaryButton, SelectRow, SettingRow, SliderRow, Stepper } from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { defaultBorderTexture } from '@dnd/core/src/engine/plateauKit';
import { SwatchPicker, type Swatch } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { installedWallSets, wallSetLabel, wallSetThumb } from '@/editor/models/assetStrip';
import type { SettingProps } from '@/editor/registry/types';
import { hasStyleOverrides, shortTextureName, TEXTURE_SCALE_RANGE } from '@/editor/models/selectionModel';
import { editChildren } from './cardWrites';
import { openAssets } from './openAssets';
import { pickedFloors, type FillValue } from './floorModel';

const NO_BAND = '__none__';

/** A band set as a swatch: a stretch of its rock as the picture. */
const bandSwatch = (id: string): Swatch => ({ value: id, label: wallSetLabel(id), art: wallSetThumb(id) });

/** Edge band: None, or one of the installed band sets. */
export function EdgeBandField({ def, value, onChange }: SettingProps<string | null>) {
  // Pack bands arrive after boot; re-read them when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const ids = getBandSetIds();
  if (value && !ids.includes(value)) ids.push(value);
  const swatches = [{ value: NO_BAND, label: 'None' }, ...ids.map(bandSwatch)];
  return (
    <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value ?? NO_BAND} onPick={(v) => onChange(v === NO_BAND ? null : v)} />
  );
}

/** The Walls value that means no wall at all: a ground piece. */
export const NO_WALLS = '__nowalls__';
/** The Walls value a walled floor shows when its walls are a plain line, with no set. */
export const PLAIN_WALLS = '__plain__';

/**
 * Walls, by picture: None first (a floor with no wall, no room), then every installed wall
 * set. Walls are chosen, never automatic.
 */
export function WallsField({ def, value, onChange }: SettingProps<string | null>) {
  // Wall sets arrive after boot; re-read them when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const ids = installedWallSets();
  if (value && value !== PLAIN_WALLS && !ids.includes(value)) ids.push(value);
  const swatches = [{ value: NO_WALLS, label: 'None' }, ...ids.map(bandSwatch)];
  // A walled floor whose walls are a plain line has no set to picture: a named tile, shown only for it.
  if (value === PLAIN_WALLS) swatches.push({ value: PLAIN_WALLS, label: 'Plain line' });
  return (
    <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value ?? NO_WALLS} onPick={(v) => onChange(v === NO_WALLS ? null : v)} />
  );
}

/** The floor card's Edge band value for a floor with a painted border. */
export const PAINTED_EDGE = '__paint__';

/** The floor card's Edge band: None, the installed band sets, or Painted border. */
export function FloorEdgeField({ def, value, onChange }: SettingProps<string | null>) {
  useStore((s) => s.packs.installedPacks);
  const ids = getBandSetIds();
  if (value && value !== PAINTED_EDGE && !ids.includes(value)) ids.push(value);
  const swatches = [
    { value: NO_BAND, label: 'None' },
    ...ids.map(bandSwatch),
    // Pictured by the texture a painted border takes until one is picked.
    { value: PAINTED_EDGE, label: 'Painted border', art: defaultBorderTexture() },
  ];
  return (
    <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value ?? NO_BAND} onPick={(v) => onChange(v === NO_BAND ? null : v)} />
  );
}

/** A floor's painted border texture: the outdoor floors the packs ship. */
export function EdgePaintField({ def, value, onChange }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const options = outdoorFloorChoices();
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: shortTextureName(value, getCatalogEntry(value)?.label) });
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={options.map((o) => ({ ...o, art: o.value }))} value={value} onPick={onChange} />;
}

/** The dungeon layers on the floor's level, by name. */
export function LayerField({ def, value, onChange }: SettingProps<string>) {
  // Read as one string, so the selector hands back the same value while nothing moved.
  const key = useStore((s) => {
    const own = s.layers.find((l) => l.id === value);
    return JSON.stringify(
      s.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon' && (!own || l.levelId === own.levelId))
        .map((l) => ({ value: l.id, label: l.name || 'Unnamed layer' })),
    );
  });
  const options = useMemo(() => JSON.parse(key) as { value: string; label: string }[], [key]);
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}

/** Colour of a floor without a texture, with Reset back to the layer's when any picked floor pins its own. */
export function ColourField({ def, value, onChange }: SettingProps<string>) {
  const pinned = useStore((s) => pickedFloors(s.selection.selectedIds).filter(hasStyleOverrides).map((f) => f.id).join(','));
  return (
    <div className="flex items-center gap-2">
      <ColourRow label={def.label} value={value} onValueChange={onChange} className="min-w-0 flex-1" />
      {pinned ? (
        <SecondaryButton
          aria-label="Reset colour to the layer's"
          onClick={() => editChildren('Reset to layer defaults', pinned.split(','), () => ({ styleOverrides: undefined }))}
        >
          Reset
        </SecondaryButton>
      ) : null}
    </div>
  );
}

/** The texture's thumb and name, and Change, which opens the asset panel on floors. */
export function TextureField({ def, value }: SettingProps<string>) {
  useStore((s) => s.packs.installedPacks);
  const name = value ? shortTextureName(value, getCatalogEntry(value)?.label) : 'None';
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-1.5">
        <span className="block h-6 w-8 overflow-hidden rounded-control border border-line bg-panel-2" title={name}>
          {value ? <PackThumbnailCanvas textureId={value} fit="cover" /> : null}
        </span>
        <SecondaryButton onClick={() => openAssets('floor')}>Change</SecondaryButton>
      </span>
    </SettingRow>
  );
}

const fmtScale = (v: number) => `×${v.toFixed(2)}`;

/** Scale, Rotate and Offset of the texture inside the floor, folded: rare, and no substitute for it. */
export function FillField({ def, value, onChange }: SettingProps<FillValue>) {
  const summary = `scale ${value.scale.toFixed(2).replace(/\.?0+$/, '')} · ${Math.round(value.rotate)}° · offset ${value.x}, ${value.y}`;
  return (
    <Fold title={def.label} summary={summary}>
      <SliderRow
        label="Scale"
        value={value.scale}
        min={TEXTURE_SCALE_RANGE.min}
        max={TEXTURE_SCALE_RANGE.max}
        step={TEXTURE_SCALE_RANGE.step}
        format={fmtScale}
        onValueChange={(scale) => onChange({ ...value, scale })}
      />
      <SliderRow
        label="Rotate"
        value={value.rotate}
        min={0}
        max={360}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onValueChange={(rotate) => onChange({ ...value, rotate })}
      />
      <SettingRow label="Offset">
        <span className="flex items-center gap-1.5">
          <Stepper label="Offset X" value={value.x} step={0.25} format={(v) => `X ${v}`} onValueChange={(x) => onChange({ ...value, x })} />
          <Stepper label="Offset Y" value={value.y} step={0.25} format={(v) => `Y ${v}`} onValueChange={(y) => onChange({ ...value, y })} />
        </span>
      </SettingRow>
    </Fold>
  );
}
