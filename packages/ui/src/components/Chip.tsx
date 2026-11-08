import { Toggle } from '../primitives/toggle';
import { cn } from '../lib/utils';

type ChipProps = Omit<React.ComponentProps<typeof Toggle>, 'variant' | 'size'>;

/** Pill toggle: 22 tall, 10 aside, 11. On is the 1.5px inset ink ring, never a fill. */
function Chip({ className, ...props }: ChipProps) {
  return (
    <Toggle
      variant="outline"
      data-composite="chip"
      className={cn('h-[22px] min-w-0 gap-1.5 rounded-pill px-2.5 text-[11px] hover:bg-panel-2', className)}
      {...props}
    />
  );
}

export { Chip };
