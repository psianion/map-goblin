// A choice between pieces of art, shown as pictures rather than a list of names: a wrapping
// row of thumbnail tiles, each with its name under it and a ring round the picked one, or, where
// a dock has no room for the row, the picked tile alone opening the row. The dock's columns and
// the cards' fields that pick art or a texture all draw through here.

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger, Tile } from '@dnd/ui';
import { PackThumbnailCanvas } from './PackThumbnailCanvas';

export interface Swatch {
  value: string;
  label: string;
  /** The pack texture shown as its picture. A choice with no art of its own (None, Auto) has none: a plain named tile. */
  art?: string;
  /** Multiplied into the picture: a door kit's slices are grey masters, told apart by their tint. */
  tint?: string;
  /** The tile's tip, where its name is cut short: the full name. */
  title?: string;
}

interface SwatchPickerProps {
  /** Written over the tiles in a card or a panel. A dock column carries its own caption: none there. */
  label?: string;
  /** What the tiles are, for a reader that sees no caption. */
  name: string;
  swatches: readonly Swatch[];
  value: string;
  onPick: (value: string) => void;
  /**
   * Shown as the picked tile alone, which opens the row of tiles above it: for a dock column
   * that would not fit beside the others as a full row.
   */
  compact?: boolean;
  /** Names wrap onto a second line under their tiles rather than being cut off: choices whose names run long. */
  twoLines?: boolean;
}

/** A tile's name on up to two lines, broken between words. */
const TWO_LINES =
  '[&_[data-slot=tile-name]]:line-clamp-2 [&_[data-slot=tile-name]]:whitespace-normal [&_[data-slot=tile-name]]:break-words [&_[data-slot=tile-name]]:text-center [&_[data-slot=tile-name]]:leading-[1.2]';

/** A swatch's picture, or nothing for a plain named tile. */
function Thumb({ swatch }: { swatch: Swatch }) {
  return (
    <>
      {swatch.art ? <PackThumbnailCanvas textureId={swatch.art} fit="cover" /> : null}
      {swatch.art && swatch.tint ? <span aria-hidden className="absolute inset-0 mix-blend-multiply" style={{ backgroundColor: swatch.tint }} /> : null}
    </>
  );
}

export function SwatchPicker({ label, name, swatches, value, onPick, compact = false, twoLines = false }: SwatchPickerProps) {
  const [open, setOpen] = useState(false);
  const tiles = (
    <div role="group" aria-label={name} data-composite="swatches" className="flex flex-wrap gap-1.5">
      {swatches.map((s) => (
        <Tile
          key={s.value}
          name={s.label}
          title={s.title ?? s.label}
          className={twoLines ? TWO_LINES : undefined}
          aria-label={s.label}
          active={s.value === value}
          data-swatch={s.value}
          onClick={() => {
            setOpen(false);
            onPick(s.value);
          }}
        >
          <Thumb swatch={s} />
        </Tile>
      ))}
    </div>
  );
  if (compact) {
    const picked = swatches.find((s) => s.value === value) ?? { value, label: value };
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Tile name={picked.label} title={`${name}: ${picked.title ?? picked.label}`} className={twoLines ? TWO_LINES : undefined} aria-label={`${name}: ${picked.label}`} data-swatch-picked={picked.value}>
              <Thumb swatch={picked} />
            </Tile>
          }
        />
        <PopoverContent side="top" align="start" className="w-auto max-w-[488px]">
          {tiles}
        </PopoverContent>
      </Popover>
    );
  }
  if (!label) return tiles;
  return (
    <div data-composite="swatch-field" className="flex w-[248px] flex-col gap-1 py-1">
      <span className="text-[12px] text-text-2">{label}</span>
      {tiles}
    </div>
  );
}
