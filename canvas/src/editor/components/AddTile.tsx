import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

type AddTileProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'children'> & {
  name: string;
};

/** The dashed tile at the end of a strip: line-strong dashes, a plus, its name under it. */
function AddTile({ name, className, ...props }: AddTileProps) {
  return (
    <Button
      variant="ghost"
      data-composite="add-tile"
      className={cn(
        'h-auto w-14 flex-col justify-start gap-[3px] rounded-control border-0 p-0 leading-normal hover:bg-transparent',
        className,
      )}
      {...props}
    >
      <span
        data-slot="tile-thumb"
        className="flex h-11 w-14 items-center justify-center rounded-control border border-dashed border-line-strong text-text-3"
      >
        <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
      </span>
      <span data-slot="tile-name" className="max-w-14 truncate text-[10px] text-text-2">
        {name}
      </span>
    </Button>
  );
}

export { AddTile };
