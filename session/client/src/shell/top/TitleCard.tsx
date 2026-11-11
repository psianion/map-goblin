import { useState } from 'react';
import { Button, FloatBox, Popover, PopoverContent, PopoverTrigger } from '@dnd/ui';
import { ChevronDown } from '@dnd/ui/icons';
import { useModuleState, useSessionStore } from '../../session/store';
import { useTableShell } from '../tableShell';
import { SceneSwitcher } from './SceneSwitcher';
import { setTableSwitch, type TableSwitches } from './sessionActions';
import { useLevelLabel, useWorldChip } from './titleData';

/**
 * Top left (board 1, 5): the live scene's name, the level, and for the DM the chevron to the
 * scene switcher, the world chip that opens the World tab, and while the table is paused a
 * Paused chip that resumes it.
 */
export function TitleCard() {
  const role = useSessionStore((s) => s.you?.role);
  const name = useSessionStore((s) => {
    const session = s.session;
    return session?.scenes.find((sc) => sc.id === session.activeSceneId)?.name ?? null;
  });
  const level = useLevelLabel();
  const world = useWorldChip();
  const paused = useModuleState<TableSwitches>('table')?.paused === true;
  const [open, setOpen] = useState(false);
  const dm = role === 'dm';
  return (
    <FloatBox
      className="absolute top-3 left-3 z-20 flex h-11 max-w-md items-center gap-2 py-0 pr-2 pl-3"
      data-testid="title-card"
      data-chrome
    >
      <span className="min-w-0 truncate text-sm font-medium text-text" data-testid="title-scene">
        {name ?? 'No scene yet'}
      </span>
      {level && (
        <span className="shrink-0 rounded-key border border-line px-1.5 font-mono text-xs text-text-2 max-sm:hidden" data-testid="title-level">
          {level}
        </span>
      )}
      {dm && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="Switch scene" data-testid="title-switcher">
                <ChevronDown aria-hidden strokeWidth={1.75} className="size-4" />
              </Button>
            }
          />
          <PopoverContent align="start" className="w-96 p-2">
            <SceneSwitcher onDone={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      )}
      {dm ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-pill"
          data-testid="title-world"
          onClick={() => {
            if (useTableShell.getState().dockTab !== 'world') useTableShell.getState().pickDockTab('world');
          }}
        >
          {world}
        </Button>
      ) : (
        <span className="shrink-0 rounded-pill border border-line px-2.5 py-0.5 text-xs text-text-2 max-sm:hidden" data-testid="title-world">
          {world}
        </span>
      )}
      {dm && paused && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-pill"
          aria-label="Paused, resume the table"
          data-testid="paused-chip"
          onClick={() => setTableSwitch('pause', false)}
        >
          Paused
        </Button>
      )}
    </FloatBox>
  );
}
