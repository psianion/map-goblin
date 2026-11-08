// Table v2 — the player's Character sheet (board 5), in the right column: their PC's face and
// name, hit points with quick damage and heal for their own token, AC, speed, passive
// Perception, conditions, whether Beyond20 is talking to this tab, and Find my token.

import { useMemo } from 'react';
import { Caption, SecondaryButton, StatusChip, cn } from '@dnd/ui';
import { LocateFixed } from '@dnd/ui/icons';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useDetectedSheet } from '../../session/detectedSheet';
import { useModuleState, useSessionStore } from '../../session/store';
import { findMyToken } from '../../shell/findMyToken';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { closeSheet } from '../../shell/sheets/registry';
import { conditionLabel, hpDanger, hpFraction, sceneTokens } from '../tokens/play';
import { HpControls } from '../tokens/TokenCard';
import { TokenPortrait } from '../tokens/TokenPortrait';
import { beyond20State } from './dice';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-control border border-line py-1.5">
      <span className="font-mono text-sm text-text tabular-nums">{value}</span>
      <span className="text-xs text-text-3">{label}</span>
    </div>
  );
}

export function CharacterSheet() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const you = useSessionStore((s) => s.you?.identityId);
  const detected = useDetectedSheet((s) => s.sheet?.name);
  const mine = useMemo(() => sceneTokens(state, sceneId).filter((t) => t.ownerId === you), [state, sceneId, you]);
  const token = mine.find((t) => t.kind === 'pc') ?? mine[0];
  const b20 = beyond20State(token?.sheet?.name, detected);

  return (
    <SheetFrame title={token?.name ?? 'Character'} onClose={closeSheet} testId="character-sheet">
      {!token ? (
        <p className="px-3 py-3 text-xs text-text-3">You have no token on this scene yet. The DM can hand you one, or claim yours on the map.</p>
      ) : (
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex items-center gap-3">
            <TokenPortrait name={token.name} assetId={token.imageAssetId} className="size-14" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-text">{token.name}</span>
              {token.hp ? (
                <span className={cn('font-mono text-sm tabular-nums', hpDanger(token) ? 'text-danger' : 'text-text-2')} data-testid="character-hp">
                  {token.hp.current} / {token.hp.max} HP
                </span>
              ) : (
                <span className="text-xs text-text-3">HP kept by the DM</span>
              )}
            </div>
          </div>
          {token.hp && (
            <>
              <span className="h-1 overflow-hidden rounded-pill bg-panel-3">
                <span className={cn('block h-full', hpDanger(token) ? 'bg-danger' : 'bg-text-2')} style={{ width: `${(hpFraction(token) ?? 0) * 100}%` }} />
              </span>
              <HpControls targets={[token]} testId="character" />
            </>
          )}
          <div className="flex gap-1.5">
            <Stat label="AC" value={token.ac !== undefined ? String(token.ac) : '—'} />
            <Stat label="Speed" value={token.speed !== undefined ? `${token.speed} ft` : '—'} />
            <Stat label="Passive" value={token.passive !== undefined ? String(token.passive) : '—'} />
          </div>
          <div className="flex flex-col gap-1">
            <Caption>Conditions</Caption>
            <span className="text-xs text-text-2" data-testid="character-conditions">
              {(token.conditions ?? []).length ? (token.conditions ?? []).map(conditionLabel).join(', ') : 'None'}
            </span>
            {(token.effects ?? []).map((e) => (
              <span key={e.name} className="text-xs text-text-3">
                {e.name}: {e.roundsLeft} round{e.roundsLeft === 1 ? '' : 's'} left
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <StatusChip data-testid="character-beyond20" data-live={b20.live ? 'true' : undefined}>
              <span aria-hidden className={cn('size-2 rounded-pill border border-line-strong', b20.live && 'bg-text-2')} />
              {b20.label}
            </StatusChip>
            <SecondaryButton icon={LocateFixed} data-testid="character-find" onClick={() => findMyToken()}>
              Find my token
            </SecondaryButton>
          </div>
        </div>
      )}
    </SheetFrame>
  );
}
