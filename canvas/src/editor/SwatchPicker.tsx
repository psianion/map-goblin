// A choice between pieces of art, shown as pictures rather than a list of names: a wrapping
// row of thumbnail tiles, each with its name under it and a ring round the picked one. The
// dock's columns and the cards' fields that pick art or a texture all draw through here.

import { Tile } from '@dnd/ui';
import { PackThumbnailCanvas } from './PackThumbnailCanvas';

export interface Swatch {
  value: string;
  label: string;
  /** The pack texture shown as its picture. A choice with no art of its own (None, Auto) has none: a plain named tile. */
  art?: string;
  /** Multiplied into the picture: a door kit's slices are grey masters, told apart by their tint. */
  tint?: string;
}

interface SwatchPickerProps {
  /** Written over the tiles in a card or a panel. A dock column carries its own caption: none there. */
  label?: string;
  /** What the tiles are, for a reader that sees no caption. */
  name: string;
  swatches: readonly Swatch[];
  value: string;
  onPick: (value: string) => void;
}

export function SwatchPicker({ label, name, swatches, value, onPick }: SwatchPickerProps) {
  const tiles = (
    <div role="group" aria-label={name} data-composite="swatches" className="flex flex-wrap gap-1.5">
      {swatches.map((s) => (
        <Tile key={s.value} name={s.label} title={s.label} aria-label={s.label} active={s.value === value} data-swatch={s.value} onClick={() => onPick(s.value)}>
          {s.art ? <PackThumbnailCanvas textureId={s.art} fit="cover" /> : null}
          {s.art && s.tint ? <span aria-hidden className="absolute inset-0 mix-blend-multiply" style={{ backgroundColor: s.tint }} /> : null}
        </Tile>
      ))}
    </div>
  );
  if (!label) return tiles;
  return (
    <div data-composite="swatch-field" className="flex w-[248px] flex-col gap-1 py-1">
      <span className="text-[12px] text-text-2">{label}</span>
      {tiles}
    </div>
  );
}
