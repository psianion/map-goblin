import { useState, type ReactElement } from 'react';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Popover, PopoverContent, PopoverTrigger, TimeTiles } from '@dnd/ui';
import { setPreview, usePreview } from '@/editor/viewPrefs';
import { useTileTints } from '@/editor/families/environment/timeTintModel';

/**
 * The preview chip's popover: Preview as, unlit or one of the four times, each tile in the
 * colour that time is drawn in. A view choice, never a map edit, so it goes through no undo.
 */
export function PreviewPopover({ trigger }: { trigger: ReactElement }) {
  const preview = usePreview();
  const tints = useTileTints();
  const [open, setOpen] = useState(false);
  // Over a sheet, Escape closes this first: the sheet hears it only once the popover is gone.
  useEscapeToClose(open, () => setOpen(false));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent side="top" align="start" className="flex w-auto flex-col gap-1.5 p-2" data-testid="shell-preview-popover">
        <TimeTiles aria-label="Preview as" unlit value={preview} onPick={setPreview} tints={tints} className="flex-nowrap" />
      </PopoverContent>
    </Popover>
  );
}
