import { useId } from 'react';
import { Switch } from '@/ui/switch';
import { SettingRow } from './SettingRow';

type SwitchRowProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** A setting row with a switch at the right. */
function SwitchRow({ label, checked, onCheckedChange, disabled, className }: SwitchRowProps) {
  const id = useId();
  return (
    <SettingRow label={label} labelId={id} className={className}>
      <Switch
        aria-labelledby={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next: boolean) => onCheckedChange(next)}
      />
    </SettingRow>
  );
}

export { SwitchRow };
