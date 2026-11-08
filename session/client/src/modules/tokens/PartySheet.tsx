// Table v2 — the Party sheet: the player characters at a glance, for the DM and players
// alike. Each PC on the live scene with its player (and whether they are here), its hit
// points (as far as `showHp` lets this seat see them), AC and conditions. Picking a row
// frames that token.

import { useMemo } from 'react';
import { cn } from '@dnd/ui';
import type { TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint } from '../../renderer/camera';
import { useModuleState, useSessionStore } from '../../session/store';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { closeSheet } from '../../shell/sheets/registry';
import { seatColour } from '../../shell/seatColour';
import { useTokenInteraction } from './drag';
import { conditionLabel, hpDanger, hpFraction, kindOf, sceneTokens } from './play';
import { TokenPortrait } from './TokenPortrait';

export function PartySheet() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players ?? []);
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const party = useMemo(() => sceneTokens(state, sceneId).filter((t) => kindOf(t) === 'pc'), [state, sceneId]);

  return (
    <SheetFrame title="Party" onClose={closeSheet} testId="party-sheet">
      {party.length === 0 ? (
        <p className="px-3 py-3 text-xs text-text-3">No player characters on this scene yet.</p>
      ) : (
        <ul className="flex flex-col">
          {party.map((t) => {
            const player = players.find((p) => p.identityId === t.ownerId);
            const left = hpFraction(t);
            return (
              <li key={t.id} className="border-b border-line">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-panel-2"
                  data-testid="party-row"
                  onClick={() => {
                    frameWorldPoint(t.x, t.y);
                    if (isDm) useTokenInteraction.getState().select(t.id);
                  }}
                >
                  <TokenPortrait name={t.name} assetId={t.imageAssetId} className="size-9" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-text">{t.name}</span>
                      {t.ac !== undefined && <span className="text-xs text-text-3">AC {t.ac}</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-text-3">
                      {player ? (
                        <>
                          <span
                            aria-hidden
                            className={cn('size-2 rounded-pill border', player.connected ? '' : 'bg-transparent')}
                            style={{ borderColor: seatColour(player.identityId), backgroundColor: player.connected ? seatColour(player.identityId) : undefined }}
                          />
                          {player.name}
                          {player.connected ? '' : ' (away)'}
                        </>
                      ) : (
                        'No player yet'
                      )}
                    </span>
                    {left !== null && t.hp && (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1 flex-1 overflow-hidden rounded-pill bg-panel-3">
                          <span className={cn('block h-full', hpDanger(t) ? 'bg-danger' : 'bg-text-2')} style={{ width: `${left * 100}%` }} />
                        </span>
                        <span className={cn('font-mono text-xs tabular-nums', hpDanger(t) ? 'text-danger' : 'text-text-2')} data-testid="party-hp">
                          {t.hp.current}/{t.hp.max}
                        </span>
                      </span>
                    )}
                    {(t.conditions ?? []).length > 0 && (
                      <span className="truncate text-xs text-text-2">{(t.conditions ?? []).map(conditionLabel).join(', ')}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetFrame>
  );
}
