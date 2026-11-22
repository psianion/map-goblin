import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { Input } from '../primitives/input';
import { SettingRow } from './SettingRow';
import { Swatch } from './Swatch';

type ColourPickerProps = {
  /** The swatch's accessible name; the hex field is named after it. */
  label: string;
  /** A hex colour, or null for none. */
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A swatch that opens a picker and a hex field, for a row that lays out its own label. */
function ColourPicker({ label, value, onValueChange, disabled }: ColourPickerProps) {
  // What is being typed into the hex field; it only reaches the value once it is a full hex.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Popover>
      <PopoverTrigger disabled={disabled} render={<Swatch label={label} color={value} />} />
      <PopoverContent align="end" className="w-auto">
        <HexColorPicker color={value ?? '#ffffff'} onChange={onValueChange} />
        <Input
          aria-label={`${label} hex`}
          className="font-mono"
          value={draft ?? value ?? ''}
          onChange={(e) => {
            setDraft(e.target.value);
            if (HEX.test(e.target.value)) onValueChange(e.target.value);
          }}
          onBlur={() => setDraft(null)}
        />
      </PopoverContent>
    </Popover>
  );
}

type ColourRowProps = ColourPickerProps & { className?: string };

/** A setting row with a swatch at the right that opens a picker and a hex field. */
function ColourRow({ label, value, onValueChange, disabled, className }: ColourRowProps) {
  return (
    <SettingRow label={label} className={className}>
      <ColourPicker label={label} value={value} onValueChange={onValueChange} disabled={disabled} />
    </SettingRow>
  );
}

export { ColourPicker, ColourRow };
