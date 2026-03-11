import { cn } from '@/lib/utils';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  disabled,
}: NumberInputProps) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className={cn(
        'w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    />
  );
}
