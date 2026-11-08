import { Button } from '../primitives/button';
import { cn } from '../lib/utils';

export type LevelListItem = { id: string; label: string };

type LevelListProps = {
  levels: LevelListItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
};

/** The dock's Level column: mono 10 rows, radius 4, 2 apart, the current one panel-3. */
function LevelList({ levels, value, onValueChange, className }: LevelListProps) {
  return (
    <div data-composite="level-list" className={cn('flex flex-col gap-[2px]', className)}>
      {levels.map((l) => {
        const on = l.id === value;
        return (
          <Button
            key={l.id}
            variant="ghost"
            aria-pressed={on}
            data-active={on ? '' : undefined}
            onClick={() => onValueChange(l.id)}
            className="h-auto w-full justify-start rounded-key border-0 px-1.5 py-0.5 font-mono text-[10px] leading-normal text-text-3 hover:bg-panel-2 hover:text-text data-[active]:bg-panel-3 data-[active]:text-text"
          >
            {l.label}
          </Button>
        );
      })}
    </div>
  );
}

export { LevelList };
