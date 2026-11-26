// The DM's seats (finishing pass 12.3): one row per player seat with its colour, name, ready
// mark, its character as a portrait, "Edit token" and where the character stands. Opening the
// character shows every PC as a picture to hand the seat; nothing here is a name dropdown. Used
// in the lobby strip's roster before Start and in the Party sheet after it.

import { useId, useRef, useState } from 'react';
import { SecondaryButton, cn } from '@dnd/ui';
import { Check, ChevronDown, LoaderCircle, MapPin, MapPinPlus, UserRoundX } from '@dnd/ui/icons';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { TokenDef, TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { sceneTokens } from '../../modules/tokens/play';
import { TokenArtEditor } from '../../modules/tokens/TokenArtEditor';
import { TokenPortrait } from '../../modules/tokens/TokenPortrait';
import { seatColour } from '../seatColour';
import { withoutSupersededSeats } from '../top/roster';
import { handCharacter, pcDefs, pcStatus, sendCommand, useLiveSceneKey, useRoster, useTable, type PcStatus } from './lobbyState';

/** Ready, still loading the live scene, or away: the same words in the roster and the lobby. */
export function SeatStatus({ seat, ready }: { seat: PlayerInfo; ready: boolean }) {
  if (!seat.connected) return <span className="text-[11px] text-text-3">Away</span>;
  if (ready) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-2">
        <Check aria-hidden strokeWidth={2} className="size-3.5" />
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-3">
      <LoaderCircle aria-hidden strokeWidth={2} className="size-3.5 animate-spin motion-reduce:animate-none" />
      Loading
    </span>
  );
}

function tileState(s: PcStatus): string {
  if (s.kind === 'taken') return `Taken by ${s.by}`;
  if (s.kind === 'saved') return `Saved for ${s.for}`;
  return s.kind === 'mine' ? "This seat's" : 'Free';
}

const TILE =
  'flex w-full flex-col items-center gap-1 rounded-control border px-1 pt-2 pb-1.5 text-center outline-none transition-[background-color,border-color,transform] duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus';

/** Every character as a picture, and "No character": picking one hands it to the seat. */
function Picker({ seat, pcs, held, onPick, id }: { seat: PlayerInfo; pcs: TokenDef[]; held: TokenDef | undefined; onPick: (defId: string | null) => void; id: string }) {
  const players = useRoster();
  return (
    <ul id={id} className="grid grid-cols-4 gap-1.5" aria-label={`Characters for ${seat.name}`} data-testid={`roster-picker-${seat.identityId}`}>
      <li>
        <button
          type="button"
          aria-pressed={!held}
          data-testid="roster-pick-none"
          className={cn(TILE, 'h-full border-dashed border-line-strong text-text-2 hover:bg-panel-2 active:scale-[0.98]', !held && 'border-solid border-ink')}
          onClick={() => onPick(null)}
        >
          <span className="flex size-10 items-center justify-center rounded-pill border border-dashed border-line-strong">
            <UserRoundX aria-hidden strokeWidth={1.75} className="size-4" />
          </span>
          <span className="text-[11px] leading-tight font-medium">No character</span>
        </button>
      </li>
      {pcs.map((def) => {
        const status = pcStatus(def, seat.identityId, players);
        const elsewhere = status.kind === 'taken';
        const mine = status.kind === 'mine';
        return (
          <li key={def.id}>
            <button
              type="button"
              disabled={elsewhere}
              aria-pressed={mine}
              data-testid="roster-pick"
              data-def-id={def.id}
              data-state={status.kind}
              className={cn(
                TILE,
                mine
                  ? 'border-ink bg-panel-2'
                  : elsewhere
                    ? 'cursor-default border-line bg-panel-2 opacity-55'
                    : 'border-line bg-panel hover:border-line-strong hover:bg-panel-2 active:scale-[0.98]',
              )}
              onClick={() => onPick(def.id)}
            >
              <TokenPortrait name={def.name} assetId={def.imageAssetId} ring={def.ring} className="size-10 text-[11px]" />
              <span className="line-clamp-1 w-full text-[11px] leading-tight font-medium text-text">{def.name}</span>
              <span className="line-clamp-1 w-full text-[10px] leading-tight text-text-3">{tileState(status)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SeatRow({ seat, pcs, readyKey }: { seat: PlayerInfo; pcs: TokenDef[]; readyKey: string | null }) {
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const { ready, started } = useTable();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pickerId = useId();
  const pc = pcs.find((d) => d.ownerIdentityId === seat.identityId);
  const isReady = !!readyKey && ready[seat.identityId] === readyKey;
  const onMap = !!pc && sceneTokens(tokens, sceneId).some((t) => t.defId === pc.id);
  const close = () => {
    setPicking(false);
    trigger.current?.focus();
  };
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 first:pt-1 last:border-b-0" data-testid="roster-seat" data-ready={isReady || undefined}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-pill', !seat.connected && 'opacity-40')} style={{ backgroundColor: seatColour(seat.identityId) }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{seat.name}</span>
        <SeatStatus seat={seat} ready={isReady} />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          ref={trigger}
          type="button"
          aria-expanded={picking}
          aria-controls={pickerId}
          aria-label={`Character for ${seat.name}: ${pc ? pc.name : 'none'}`}
          data-testid={`roster-pc-${seat.identityId}`}
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-line bg-panel px-2 text-left outline-none transition-colors hover:bg-panel-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-expanded:bg-panel-2"
          onClick={() => setPicking((v) => !v)}
        >
          {pc ? (
            <TokenPortrait name={pc.name} assetId={pc.imageAssetId} ring={pc.ring} className="size-9 text-[11px]" />
          ) : (
            <span aria-hidden className="size-9 shrink-0 rounded-pill border border-dashed border-line-strong" />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn('truncate text-[13px]', pc ? 'text-text' : 'text-text-2')}>{pc ? pc.name : 'No character'}</span>
            <span className="truncate text-[11px] text-text-3">{pc ? 'Change character' : 'Choose a character'}</span>
          </span>
          <ChevronDown aria-hidden strokeWidth={1.75} className={cn('size-4 shrink-0 text-text-3 transition-transform duration-150', picking && 'rotate-180')} />
        </button>
        <SecondaryButton disabled={!pc} className="h-12 px-2.5" data-testid={`roster-edit-${seat.identityId}`} active={editing} onClick={() => setEditing((v) => !v)}>
          Edit token
        </SecondaryButton>
      </div>
      {picking && (
        <div
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close();
          }}
        >
          <Picker
            id={pickerId}
            seat={seat}
            pcs={pcs}
            held={pc}
            onPick={(defId) => {
              handCharacter(seat, defId, tokens, sceneId);
              close();
            }}
          />
        </div>
      )}
      {pc && !picking && (
        <div className="flex min-h-6 items-center" data-testid={`roster-where-${seat.identityId}`}>
          {!started ? (
            <span className="text-[11px] text-text-3">Appears on the map at Start</span>
          ) : onMap ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-2">
              <MapPin aria-hidden strokeWidth={1.75} className="size-3.5" />
              On the map
            </span>
          ) : (
            <SecondaryButton icon={MapPinPlus} data-testid={`roster-place-${seat.identityId}`} onClick={() => sendCommand('tokens', 'place-pc', { defId: pc.id })}>
              Put on the map
            </SecondaryButton>
          )}
        </div>
      )}
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

/** Every player seat at the table, or the words for none yet. */
export function SeatRoster() {
  const roster = useRoster();
  const tokens = useModuleState<TokensState>('tokens');
  const key = useLiveSceneKey();
  const seats = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  const pcs = pcDefs(tokens).sort((a, b) => a.name.localeCompare(b.name));
  if (seats.length === 0) {
    return (
      <p className="py-2 text-xs text-text-3" data-testid="roster-empty">
        Nobody has joined yet. Players who join wait here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col" data-testid="roster-seats">
      {seats.map((p) => (
        <SeatRow key={p.identityId} seat={p} pcs={pcs} readyKey={key} />
      ))}
    </ul>
  );
}
