// The lobby (table lobby pass, plan 3.6): a player's whole page while the DM sets up. No map:
// the table, your character (pick one, make one, then its picture and ring), everyone at the
// table with a ready mark, and the map downloading underneath so Start is quick.

import { SecondaryButton, cn, progressFraction } from '@dnd/ui';
import { Check } from '@dnd/ui/icons';
import { notify } from '@dnd/ui/toast';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useTableAssets } from '../../renderer/assetLoading';
import { useModuleState, useSessionStore } from '../../session/store';
import { SceneThumb } from '../../modules/scene/SceneThumb';
import { TokenArtEditor } from '../../modules/tokens/TokenArtEditor';
import { TokenPortrait } from '../../modules/tokens/TokenPortrait';
import { ConnectionNotice } from '../Connection';
import { seatColour } from '../seatColour';
import { TableToaster } from '../TableToaster';
import { withoutSupersededSeats } from '../top/roster';
import { leaveTable } from '../top/sessionActions';
import { CharacterPicker } from './CharacterPicker';
import { pcOf, sendCommand, useTable } from './lobbyState';
import { useLobbyLoading, type LobbyLoad } from './loading';

const LOAD_WORDS: Record<LobbyLoad['state'], string> = {
  loading: 'Getting the map ready',
  ready: 'Map ready',
  failed: 'The map loads when the table starts',
};

const PANEL = 'rounded-float border border-line bg-panel';

function YourCharacter() {
  const tokens = useModuleState<TokensState>('tokens');
  const you = useSessionStore((s) => s.you?.identityId);
  const mine = pcOf(tokens, you);
  return (
    <section className={cn(PANEL, 'flex flex-col gap-4 p-4 sm:p-5')} aria-labelledby="lobby-character" data-testid="lobby-character">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="lobby-character" className="text-sm font-medium text-text">
          Your character
        </h2>
        {mine && (
          <SecondaryButton data-testid="lobby-change" onClick={() => sendCommand('tokens', 'pc-release', {})}>
            Choose a different one
          </SecondaryButton>
        )}
      </div>
      {mine && you ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1 sm:w-40 sm:pt-1">
            <span className="truncate text-lg font-medium text-text" data-testid="lobby-mine">
              {mine.name}
            </span>
            <span className="text-xs text-text-3">Set the picture and ring the table sees on the map.</span>
          </div>
          <TokenArtEditor
            key={mine.id}
            name={mine.name}
            imageAssetId={mine.imageAssetId}
            ring={mine.ring}
            defaultRing={seatColour(you)}
            onSave={(art) => {
              sendCommand('tokens', 'pc-update', art);
              notify.subtle('Token saved');
            }}
          />
        </div>
      ) : (
        <CharacterPicker />
      )}
    </section>
  );
}

function Seats({ load }: { load: LobbyLoad }) {
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const you = useSessionStore((s) => s.you?.identityId);
  const tokens = useModuleState<TokensState>('tokens');
  const { ready } = useTable();
  const players = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  return (
    <section className={cn(PANEL, 'flex flex-col gap-3 p-4 sm:p-5')} aria-labelledby="lobby-seats">
      <h2 id="lobby-seats" className="text-sm font-medium text-text">
        At the table
      </h2>
      <ul className="flex flex-col" data-testid="lobby-seats">
        {players.map((p) => {
          const pc = pcOf(tokens, p.identityId);
          const isReady = !!load.key && ready[p.identityId] === load.key;
          return (
            <li
              key={p.identityId}
              className="flex min-h-12 items-center gap-3 border-b border-line py-2 last:border-b-0"
              data-testid="lobby-seat"
              data-ready={isReady || undefined}
            >
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-pill', !p.connected && 'opacity-40')} style={{ backgroundColor: seatColour(p.identityId) }} />
              {pc ? (
                <TokenPortrait name={pc.name} assetId={pc.imageAssetId} ring={pc.ring} className="size-8" />
              ) : (
                <span aria-hidden className="size-8 shrink-0 rounded-pill border border-dashed border-line-strong" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-text">
                  {p.name}
                  {p.identityId === you && <span className="text-text-3"> (you)</span>}
                </span>
                <span className="truncate text-[11px] text-text-3">{pc ? pc.name : 'Choosing a character'}</span>
              </span>
              <span className="shrink-0 text-[11px] text-text-3">
                {!p.connected ? (
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Footer({ load }: { load: LobbyLoad }) {
  const progress = useTableAssets((s) => s.map?.progress);
  const fraction = progressFraction(progress);
  return (
    <footer className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-sm" role="status" aria-live="polite" data-testid="lobby-loading" data-state={load.state}>
        <span className="flex items-center gap-1.5 text-xs text-text-2">
          {load.state === 'ready' && <Check aria-hidden strokeWidth={2} className="size-3.5" />}
          {LOAD_WORDS[load.state]}
          {load.state === 'loading' && fraction !== null && <span className="font-mono text-text-3 tabular-nums">{Math.round(fraction * 100)}%</span>}
        </span>
        {load.state === 'loading' && (
          <span aria-hidden className="relative h-0.5 overflow-hidden rounded-[1px] bg-line">
            <span
              className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.round((fraction ?? 0.08) * 100)}%` }}
            />
          </span>
        )}
      </div>
      <SecondaryButton className="self-start sm:self-auto" data-testid="lobby-leave" onClick={leaveTable}>
        Leave table
      </SecondaryButton>
    </footer>
  );
}

/** A player's page on a table that has not started. */
export function Lobby() {
  const dm = useSessionStore((s) => s.session?.players.find((p) => p.role === 'dm')?.name);
  const scene = useSessionStore((s) => s.session?.scenes.find((sc) => sc.id === s.session?.activeSceneId) ?? null);
  const { lobbyShowsScene } = useTable();
  const load = useLobbyLoading();
  return (
    <div data-page="table" className="relative min-h-full bg-bg text-text" data-testid="lobby">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1040px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium tracking-tight text-text" data-testid="lobby-table">
              {dm ? `${dm}'s table` : 'The table'}
            </h1>
            <p className="text-sm text-text-2">Waiting for the DM to start</p>
          </div>
          {lobbyShowsScene && scene && (
            <div className="flex items-center gap-3" data-testid="lobby-scene">
              <SceneThumb
                scene={{ ...scene, thumbnail: true }}
                className="flex h-12 w-16 shrink-0 items-center justify-center rounded-control border border-line bg-panel-2 text-sm text-text-3"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] text-text-3">Scene</span>
                <span className="truncate text-sm font-medium text-text">{scene.name}</span>
              </span>
            </div>
          )}
        </header>
        <main className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <YourCharacter />
          <Seats load={load} />
        </main>
        <Footer load={load} />
      </div>
      <ConnectionNotice />
      <TableToaster />
    </div>
  );
}
