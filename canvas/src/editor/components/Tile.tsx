import { Lock } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

type TileProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'color'> & {
  name: string;
  active?: boolean;
  locked?: boolean;
  /** A flat fill for the thumb, such as a material's colour. Children draw over it. */
  color?: string;
};

/** A 56 by 44 thumb, radius 6, with its name 10 in text-2 under it, 3px apart. */
function Tile({ name, active, locked, color, children, className, ...props }: TileProps) {
  return (
    <Button
      variant="ghost"
      aria-pressed={active}
      data-composite="tile"
      data-active={active ? '' : undefined}
      className={cn(
        'h-auto w-14 flex-col justify-start gap-[3px] rounded-control border-0 p-0 leading-normal hover:bg-transparent',
        className,
      )}
      {...props}
    >
      <span
        data-slot="tile-thumb"
        className={cn(
          'relative block h-11 w-14 overflow-hidden rounded-control border border-line bg-panel-2',
          active && 'ring-[1.5px] ring-ink ring-inset',
        )}
        style={color ? { backgroundColor: color } : undefined}
      >
        {children}
        {locked ? (
          <Lock
            aria-label="Locked"
            strokeWidth={1.75}
            className="absolute top-[3px] right-[3px] size-3.5 text-text-3"
          />
        ) : null}
      </span>
      <span data-slot="tile-name" className="max-w-14 truncate text-[10px] text-text-2">
        {name}
      </span>
    </Button>
  );
}

export { Tile };
