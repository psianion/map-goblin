import { X } from 'lucide-react';
import { Button, ColourRow, cn } from '@dnd/ui';
import { setTimeTint, type TimeTint } from './timeTintModel';

/** What a colour row in a `SlotRow` takes: the row's width less the slot. */
export const SLOTTED = 'w-auto min-w-0 flex-1';

/** A colour row with room after its swatch for a clear button, so a column of them lines up. */
export function SlotRow({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex w-[248px] items-center gap-1', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * One time of day's own colour: a swatch that sets it, empty while the time uses the map's
 * Colour, and after it, once set, a button that clears it back to Colour.
 */
export function TimeTintRow({ tint, label = tint.label, className }: { tint: TimeTint; label?: string; className?: string }) {
  return (
    <SlotRow className={className} data-time-tint={tint.time}>
      <ColourRow label={label} value={tint.own} onValueChange={(c) => setTimeTint(tint.time, c)} className={SLOTTED} />
      {tint.own ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Clear the ${tint.label} tint`}
          title="Use Colour"
          onClick={() => setTimeTint(tint.time, null)}
        >
          <X aria-hidden strokeWidth={1.75} className="size-3.5" />
        </Button>
      ) : (
        <span aria-hidden className="size-[26px] shrink-0" />
      )}
    </SlotRow>
  );
}
