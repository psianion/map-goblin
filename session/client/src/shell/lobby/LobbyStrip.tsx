// The DM's side of the lobby (plan 3.7): while the table is not started, a strip under the
// title card says so, counts who has the map, and starts the table. The count opens the
// roster: each seat's character and ready mark, a picker to hand a seat a character, its
// token's picture, the two lobby switches and the party start tool.

import { useState } from 'react';
import { Button, FloatBox, Popover, PopoverContent, PopoverTrigger, PrimaryButton, SecondaryButton, Separator, SwitchRow, cn } from '@dnd/ui';
import { Check, ChevronDown, SquareDashed } from '@dnd/ui/icons';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { TokenDef, TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { sceneTokens } from '../../modules/tokens/play';
import { TokenArtEditor } from '../../modules/tokens/TokenArtEditor';
import { seatColour } from '../seatColour';
import { withoutSupersededSeats } from '../top/roster';
import { armPartyStart, handCharacter, pcDefs, pcOf, sendCommand, useLiveSceneKey, useTable } from './lobbyState';

const selectClass = 'h-7 min-w-0 flex-1 rounded-control border border-line bg-panel px-1.5 text-xs text-text';

function SeatRow({ seat, pcs, readyKey }: { seat: PlayerInfo; pcs: TokenDef[]; readyKey: string | null }) {
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const { ready } = useTable();
  const [editing, setEditing] = useState(false);
  const pc = pcOf(tokens, seat.identityId);
  const isReady = !!readyKey && ready[seat.identityId] === readyKey;
  const onMap = !!pc && sceneTokens(tokens, sceneId).some((t) => t.defId === pc.id);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-2.5 last:border-b-0" data-testid="roster-seat" data-ready={isReady || undefined}>
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-pill', !seat.connected && 'opacity-40')} style={{ backgroundColor: seatColour(seat.identityId) }} />
        <span className="min-w-0 flex-1 truncate text-text">{seat.name}</span>
        <span className="shrink-0 text-text-3">
          {!seat.connected ? (
            'Away'
          ) : isReady ? (
            <span className="inline-flex items-center gap-1 text-text-2">
              <Check aria-hidden strokeWidth={2} className="size-3.5" />
              Ready
            </span>
          ) : (
            'Loading'
          )}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`Character for ${seat.name}`}
          data-testid={`roster-pc-${seat.identityId}`}
          className={selectClass}
          value={pc?.id ?? ''}
          onChange={(e) => handCharacter(seat, e.target.value || null, tokens, sceneId)}
        >
          <option value="">No character</option>
          {pcs.map((d) => {
            const other = d.ownerIdentityId && d.ownerIdentityId !== seat.identityId;
            return (
              <option key={d.id} value={d.id} disabled={!!other}>
                {other ? `${d.name} (${d.ownerName ?? 'taken'})` : d.name}
              </option>
            );
          })}
        </select>
        <SecondaryButton disabled={!pc} data-testid={`roster-edit-${seat.identityId}`} onClick={() => setEditing((v) => !v)}>
          Edit token
        </SecondaryButton>
      </div>
      {pc && !onMap && <span className="text-[11px] text-text-3">Not on the map</span>}
      {pc && editing && (
        <TokenArtEditor
          key={pc.id}
          name={pc.name}
          imageAssetId={pc.imageAssetId}
          ring={pc.ring}
          defaultRing={seatColour(seat.identityId)}
          onCancel={() => setEditing(false)}
          onSave={(art) => {
            sendCommand('tokens', 'library-upsert', { id: pc.id, ...art });
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

function Roster({ onArm }: { onArm: () => void }) {
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const tokens = useModuleState<TokensState>('tokens');
  const table = useTable();
  const key = useLiveSceneKey();
  const seats = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  const pcs = pcDefs(tokens).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-3" data-testid="lobby-roster">
      {seats.length === 0 ? (
        <p className="text-xs text-text-3">Nobody has joined yet. Players who join wait here.</p>
      ) : (
        <ul className="flex flex-col">
          {seats.map((p) => (
            <SeatRow key={p.identityId} seat={p} pcs={pcs} readyKey={key} />
          ))}
        </ul>
      )}
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
  const roster = useSessionStore((s) => s.session?.players ?? []);
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
        <PopoverContent align="start" className="flex max-h-[min(640px,calc(100dvh-8rem))] w-[360px] flex-col overflow-y-auto p-3">
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
