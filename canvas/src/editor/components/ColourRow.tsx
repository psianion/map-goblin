import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Input } from '@/ui/input';
import { SettingRow } from './SettingRow';
import { Swatch } from './Swatch';

type ColourRowProps = {
  label: string;
  /** A hex colour, or null for none. */
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A setting row with a swatch at the right that opens a picker and a hex field. */
function ColourRow({ label, value, onValueChange, disabled, className }: ColourRowProps) {
  // What is being typed into the hex field; it only reaches the value once it is a full hex.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <SettingRow label={label} className={className}>
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
    </SettingRow>
  );
}

export { ColourRow };
