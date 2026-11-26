// The DM's side of the lobby (plan 3.7): while the table is not started, a strip under the
// title card says so, counts who has the map, and starts the table. The count opens the
// roster: each seat with its character as a picture (`SeatRoster`), the two lobby switches and
// the party start tool.

import { useState } from 'react';
import { Button, Caption, FloatBox, Popover, PopoverContent, PopoverTrigger, PrimaryButton, SecondaryButton, Separator, SwitchRow } from '@dnd/ui';
import { ChevronDown, SquareDashed } from '@dnd/ui/icons';
import { useSessionStore } from '../../session/store';
import { withoutSupersededSeats } from '../top/roster';
import { armPartyStart, sendCommand, useLiveSceneKey, useRoster, useTable } from './lobbyState';
import { SeatRoster } from './SeatRoster';

function Roster({ onArm }: { onArm: () => void }) {
  const table = useTable();
  return (
    <div className="flex flex-col gap-3" data-testid="lobby-roster">
      <Caption>At the table</Caption>
      <SeatRoster />
      <Separator />
      <SwitchRow
        label="Players can make their own character"
        className="w-full"
        checked={table.playersMakePcs}
        onCheckedChange={(on) => sendCommand('table', 'set-lobby', { playersMakePcs: on })}
      />
      <SwitchRow
        label="Show the scene in the lobby"
        className="w-full"
        checked={table.lobbyShowsScene}
        onCheckedChange={(on) => sendCommand('table', 'set-lobby', { lobbyShowsScene: on })}
      />
      <SecondaryButton icon={SquareDashed} className="self-start" data-testid="lobby-party-start" onClick={onArm}>
        Set party start
      </SecondaryButton>
    </div>
  );
}

/** "Not started", who is ready, and Start, under the DM's title card. */
export function LobbyStrip() {
  const dm = useSessionStore((s) => s.you?.role === 'dm');
  const roster = useRoster();
  const { started, ready } = useTable();
  const key = useLiveSceneKey();
  const [open, setOpen] = useState(false);
  if (!dm || started) return null;
  const here = withoutSupersededSeats(roster).filter((p) => p.role === 'player' && p.connected);
  const readyCount = here.filter((p) => !!key && ready[p.identityId] === key).length;
  return (
    <FloatBox className="absolute top-16 left-16 z-20 flex h-11 max-w-[calc(100%-5rem)] items-center gap-1.5 py-0 pr-1.5 pl-3" data-testid="lobby-strip" data-chrome role="status">
      <span className="shrink-0 text-sm font-medium text-text">Not started</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-text-2" data-testid="lobby-ready-count">
              {here.length === 0 ? 'No players yet' : `${readyCount} of ${here.length} ready`}
              <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />
            </Button>
          }
        />
        <PopoverContent align="start" className="flex max-h-[min(680px,calc(100dvh-8rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain p-3">
          <Roster
            onArm={() => {
              setOpen(false);
              armPartyStart();
            }}
          />
        </PopoverContent>
      </Popover>
      <PrimaryButton className="shrink-0" data-testid="lobby-start" onClick={() => sendCommand('table', 'start', { on: true })}>
        Start the table
      </PrimaryButton>
    </FloatBox>
  );
}
