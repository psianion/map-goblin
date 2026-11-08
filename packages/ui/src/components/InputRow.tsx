import { useId } from 'react';
import { Input } from '../primitives/input';
import { SettingRow } from './SettingRow';

type InputRowProps = Omit<React.ComponentProps<typeof Input>, 'className'> & {
  label: string;
  className?: string;
};

/** A setting row with a 72 wide input at the right; numbers set in mono. */
function InputRow({ label, className, ...props }: InputRowProps) {
  const id = useId();
  return (
    <SettingRow label={label} htmlFor={id} className={className}>
      <Input id={id} className="w-[72px]" {...props} />
    </SettingRow>
  );
}

export { InputRow };
