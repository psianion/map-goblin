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
        'w-16 h-7 rounded-sm',
        'bg-transparent border border-border-default',
        'font-mono text-panel-small text-text-primary',
        'px-2 tabular-nums',
        'focus:border-border-focus focus:outline-none',
        'transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        className,
      )}
    />
  );
}
