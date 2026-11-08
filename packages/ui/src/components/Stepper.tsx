import { Button } from '../primitives/button';
import { cn } from '../lib/utils';

type StepperProps = {
  value: number;
  onValueChange: (value: number) => void;
  /** Accessible name of the group; the cells read "Decrease" and "Increase" it. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** How the value reads, for example with a sign on offsets. */
  format?: (value: number) => string;
  className?: string;
};

const cell =
  'h-full w-[22px] rounded-none border-0 p-0 font-mono text-[11px] text-text-3 hover:bg-panel-2 hover:text-text focus-visible:outline-offset-[-2px]';

/** 24 tall hairline box: a 22 minus cell, the mono 11 value, a 22 plus cell. */
function Stepper({
  value,
  onValueChange,
  label,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format,
  className,
}: StepperProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-composite="stepper"
      className={cn(
        'inline-flex h-6 items-center overflow-hidden rounded-control border border-line font-mono text-[11px] text-text',
        className,
      )}
    >
      <Button
        variant="ghost"
        aria-label={`Decrease ${label}`}
        disabled={value - step < min}
        onClick={() => onValueChange(Math.max(min, value - step))}
        className={cn(cell, 'border-r border-line')}
      >
        −
      </Button>
      <span className="min-w-9 px-2 text-center tabular-nums">{format ? format(value) : value}</span>
      <Button
        variant="ghost"
        aria-label={`Increase ${label}`}
        disabled={value + step > max}
        onClick={() => onValueChange(Math.min(max, value + step))}
        className={cn(cell, 'border-l border-line')}
      >
        +
      </Button>
    </div>
  );
}

export { Stepper };
