import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { SettingRow } from './SettingRow';

export type SelectRowOption = { value: string; label: string };

type SelectRowProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectRowOption[];
  disabled?: boolean;
  className?: string;
};

/** A setting row with a 24 select at the right. */
function SelectRow({ label, value, onValueChange, options, disabled, className }: SelectRowProps) {
  const id = useId();
  return (
    <SettingRow label={label} labelId={id} className={className}>
      <Select
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(next: string | null) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <SelectTrigger aria-labelledby={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export { SelectRow };
