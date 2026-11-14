// The fields a sized map is made with, shared by the New map and Map settings dialogs: its
// size, from the standard grid presets or typed, and its base ground, picked by picture.

import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import { Input, Seg } from '@dnd/ui';
import { useStore } from '@/store/store';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { ErrorLine, Field, Hint } from './parts';
import { groundSwatches, SIZE_CUSTOM, SIZE_PRESETS } from './sizedMap';

export interface MapSizeFieldsProps {
  preset: string;
  onPresetChange: (preset: string) => void;
  widthText: string;
  heightText: string;
  onWidthChange: (text: string) => void;
  onHeightChange: (text: string) => void;
  /** Custom is chosen and the two numbers are not a size `normalizeFixedSize` accepts. */
  invalid: boolean;
}

/** A sized map's size: the presets, or Custom with the two numbers. */
export function MapSizeFields({ preset, onPresetChange, widthText, heightText, onWidthChange, onHeightChange, invalid }: MapSizeFieldsProps) {
  return (
    <Field label="Size">
      <Seg
        aria-label="Size"
        value={preset}
        onValueChange={(v) => onPresetChange(v as string)}
        options={[...SIZE_PRESETS.map((p) => ({ value: p.value as string, label: `${p.width}×${p.height}` })), { value: SIZE_CUSTOM, label: 'Custom' }]}
      />
      {preset === SIZE_CUSTOM && (
        <div className="flex items-center gap-1.5 text-[12px] text-text-2">
          <Input
            className="w-[72px]"
            inputMode="numeric"
            aria-label="Width in squares"
            aria-invalid={invalid || undefined}
            value={widthText}
            onChange={(e) => onWidthChange(e.target.value)}
          />
          <span>×</span>
          <Input
            className="w-[72px]"
            inputMode="numeric"
            aria-label="Height in squares"
            aria-invalid={invalid || undefined}
            value={heightText}
            onChange={(e) => onHeightChange(e.target.value)}
          />
          <span>squares</span>
        </div>
      )}
      {invalid ? (
        <ErrorLine>Whole numbers, at most {MAX_FIXED_CELLS.toLocaleString()} squares in all.</ErrorLine>
      ) : (
        <Hint>The map keeps this size; resize it in Map settings.</Hint>
      )}
    </Field>
  );
}

/** The base ground, picked by picture: it covers every square, cannot be erased, and is changed here. */
export function GroundField({ value, onPick }: { value: string; onPick: (choice: string) => void }) {
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  return (
    <Field label="Ground">
      <SwatchPicker name="Ground" swatches={groundSwatches()} value={value} onPick={onPick} />
      <Hint>Covers every square under what you draw. Erasing never removes it.</Hint>
    </Field>
  );
}
