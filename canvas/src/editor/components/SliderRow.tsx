import { useId } from 'react';
import { Slider } from '@/ui/slider';
import { cn } from '@/lib/utils';

type SliderRowProps = {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** How the readout reads, for example "16 sq" or "40%". */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
};

/** Label left, the mono value right beside it, and the track on its own line, full width. */
function SliderRow({ label, value, onValueChange, min = 0, max = 100, step = 1, format, disabled, className }: SliderRowProps) {
  const id = useId();
  return (
    <div
      data-composite="slider-row"
      className={cn('grid min-h-7 w-[248px] grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1.5', className)}
    >
      <label id={id} className="min-w-0 truncate text-[12px] text-text-2">
        {label}
      </label>
      <span data-slot="slider-row-value" className="font-mono text-[11px] text-text tabular-nums">
        {format ? format(value) : value}
      </span>
      <Slider
        className="col-span-2"
        aria-labelledby={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next: number | readonly number[]) => onValueChange(typeof next === 'number' ? next : next[0])}
      />
    </div>
  );
}

export { SliderRow };
