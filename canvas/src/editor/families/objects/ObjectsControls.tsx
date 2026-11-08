// The Objects tools' own controls: a compact slider for the dock, the Angle chip, the
// Variant stepper with Random at its end, the tint swatch, Scatter's tints and the prop
// strip both tools share.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { MAX_SCATTER_TINTS } from '@dnd/core/src/store/slices/tools';
import { familyKeyOf, familyPosition, getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import {
  AddTile,
  DockColumn,
  SecondaryButton,
  SettingRow,
  Swatch,
  Tile,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from '@dnd/ui';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { pickAssetForTool, propCandidates } from '@/editor/models/assetStrip';
import { openAssets } from '@/editor/families/design/openAssets';
import { RANDOM, variantStep } from './variant';

/** The readout a compact slider shows: × for a scale, else two places. */
function readout(unit: string | undefined, v: number): string {
  return unit === '×' ? `×${v.toFixed(2)}` : v.toFixed(2);
}

/** A short track and its value, for the dock, where the column's caption names it. */
export function CompactSlider({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <span className="flex w-[132px] items-center gap-2">
      <Slider
        aria-label={def.label}
        className="flex-1"
        value={[value]}
        min={r?.min}
        max={r?.max}
        step={r?.step}
        onValueChange={(next: number | readonly number[]) => onChange(typeof next === 'number' ? next : next[0])}
      />
      <span className="w-10 text-right font-mono text-[11px] text-text tabular-nums">{readout(r?.unit, value)}</span>
    </span>
  );
}

/**
 * The next stamp's angle as a chip: the wheel over it turns 15°, Shift+wheel 1°, a click
 * puts it back to 0°. The wheel on the map turns it 15° as well (StampScatterTool).
 */
export function AngleChip({ def, value, onChange }: SettingProps<number>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-w-12 font-mono tabular-nums"
      aria-label={`${def.label} ${value}°, click resets to 0°`}
      data-tip="Wheel turns it 15°, Shift+wheel 1°; click resets"
      onClick={() => onChange(0)}
      onWheel={(e) => {
        const delta = e.deltaY || e.deltaX;
        if (delta === 0) return;
        const step = (e.shiftKey ? 1 : 15) * (delta < 0 ? 1 : -1);
        onChange((((value + step) % 360) + 360) % 360);
      }}
    >
      {value}°
    </Button>
  );
}

/** The stamp's place in its family, ‹ 2/7 ›, with Random one past the last. */
export function VariantStepper({ def, value, onChange }: SettingProps<string>) {
  // The families arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const asset = useStore((s) => s.tools.settings.scatterBrush.assetIds[0]);
  const { index, count } = asset ? familyPosition(asset) : { index: 0, count: 0 };
  const alone = count < 2;
  const shown = value === RANDOM ? 'Random' : count > 0 ? `${index}/${count}` : '-';
  const cell = 'h-full w-[22px] rounded-none border-0 p-0 text-text-3 hover:bg-panel-2 hover:text-text';
  return (
    <div role="group" aria-label={def.label} className="inline-flex h-6 items-center overflow-hidden rounded-control border border-line">
      <Button variant="ghost" aria-label={`Previous ${def.label}`} disabled={alone} className={`${cell} border-r border-line`} onClick={() => asset && onChange(variantStep(asset, value, -1))}>
        <ChevronLeft aria-hidden className="size-3" />
      </Button>
      <span className="min-w-14 px-2 text-center font-mono text-[11px] text-text tabular-nums">{shown}</span>
      <Button variant="ghost" aria-label={`Next ${def.label}`} disabled={alone} className={`${cell} border-l border-line`} onClick={() => asset && onChange(variantStep(asset, value, 1))}>
        <ChevronRight aria-hidden className="size-3" />
      </Button>
    </div>
  );
}

/** A swatch for the colour the next stamp is placed with; None puts it back to untinted. */
export function TintSwatch({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  const none = value.toLowerCase() === '#ffffff';
  return (
    <Popover>
      <PopoverTrigger render={<Swatch label={def.label} color={none ? null : value} />} />
      <PopoverContent side="top" align="start" className="flex w-auto flex-col gap-2">
        <HexColorPicker color={value} onChange={onChange} />
        <Input
          aria-label={`${def.label} hex`}
          className="font-mono"
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
        <SecondaryButton disabled={none} onClick={() => onChange('#ffffff')}>
          None
        </SecondaryButton>
      </PopoverContent>
    </Popover>
  );
}

/** Scatter's tints, up to four, each prop takes one at random; empty scatters untinted. */
export function TintsField({ def, value, onChange }: SettingProps<string[]>) {
  return (
    <SettingRow label={`${def.label} ${value.length} of ${MAX_SCATTER_TINTS}`}>
      <span className="flex items-center gap-1.5">
        {value.map((c, i) => (
          <Popover key={i}>
            <PopoverTrigger render={<Swatch label={`Tint ${i + 1}`} color={c} />} />
            <PopoverContent align="end" className="flex w-auto flex-col gap-2">
              <HexColorPicker color={c} onChange={(next) => onChange(value.map((t, j) => (j === i ? next : t)))} />
              <SecondaryButton onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</SecondaryButton>
            </PopoverContent>
          </Popover>
        ))}
        {value.length < MAX_SCATTER_TINTS && (
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Add a tint"
            className="size-6"
            onClick={() => onChange([...value, NEW_TINTS.find((t) => !value.includes(t)) ?? NEW_TINTS[0]])}
          >
            <Plus aria-hidden className="size-3" />
          </Button>
        )}
      </span>
    </SettingRow>
  );
}

/** What a new tint starts as, greys to earth browns, each the first the pool lacks. */
const NEW_TINTS = ['#a39a8c', '#8c968a', '#99909a', '#8f8a82', '#a0806c', '#b3a487'];

/** Tiles in the strip, so the dock keeps its width across tools. */
const STRIP_TILES = 6;

/**
 * The props both tools place: starred first, then recent, then what the brush holds, then
 * the catalogue. Stamp holds one; Scatter's pool takes several. Library opens the panel.
 */
export function PropsColumn() {
  const recent = useStore(useShallow((s) => s.assets.recentlyUsed));
  const favourites = useStore(useShallow((s) => s.assets.favourites));
  const pool = useStore(useShallow((s) => s.tools.settings.scatterBrush.assetIds));
  useStore((s) => s.packs.installedPacks);
  const ids = propCandidates(recent, pool, favourites).slice(0, STRIP_TILES);
  return (
    <DockColumn title="Props" data-column="props" data-testid="objects-props">
      {ids.map((id) => {
        const name = getCatalogEntry(id)?.label ?? id;
        const starred = favourites.includes(id) || favourites.includes(familyKeyOf(id));
        return (
          <Tile key={id} name={name} aria-label={name} active={pool.includes(id)} onClick={() => pickAssetForTool(id)}>
            <PackThumbnailCanvas textureId={id} />
            {starred ? <Star aria-label="Favourite" className="absolute top-[3px] left-[3px] size-2.5 fill-current text-text-2" strokeWidth={0} /> : null}
          </Tile>
        );
      })}
      <AddTile name="Library" onClick={() => openAssets('object')} />
    </DockColumn>
  );
}
