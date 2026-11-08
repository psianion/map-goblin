// Table v2 — the DM dock's Encounter tab (board 16). Left: run the fight (Start, Roll for
// NPCs, Previous, Next, the round, End behind a confirm), hit points and conditions for the
// selection with Half on save, and effect timers that tick down each round. Right: the turn
// order with each combatant's number, and the room keys' prepped encounters with Spawn.

import { useMemo, useState } from 'react';
import { Caption, IconKeyButton, Input, PrimaryButton, SecondaryButton, cn } from '@dnd/ui';
import { ChevronLeft, ChevronRight, X } from '@dnd/ui/icons';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { useTokenInteraction } from '../tokens/drag';
import { parseWhole, sceneTokens, sendTokens } from '../tokens/play';
import { spawnEncounter, usePreppedEncounters } from '../tokens/prepped';
import { ConditionChips, HpControls } from '../tokens/TokenCard';
import { addToCombat, rollForNpcs, sendInitiative } from './combat';
import { useCombatBar } from './useCombatBar';

function useScene() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const tokens = useMemo(() => sceneTokens(state, sceneId), [state, sceneId]);
  return { tokens, sceneId };
}

/** The tokens the selection names, in selection order. */
function useSelection(tokens: readonly Token[]): Token[] {
  const ids = useTokenInteraction((s) => s.selectedIds);
  return useMemo(() => {
    const byId = new Map(tokens.map((t) => [t.id, t]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [tokens, ids]);
}

function Controls() {
  const state = useModuleState<InitiativeState>('initiative');
  const bar = useCombatBar();
  const { tokens, sceneId } = useScene();
  const selection = useSelection(tokens);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const status = state?.status ?? 'idle';
  const elsewhere = status !== 'idle' && state?.sceneId !== sceneId;

  if (status === 'idle') {
    const who = selection.length > 0 ? selection : tokens.filter((t) => !t.hidden);
    return (
      <div className="flex flex-col gap-1">
        <PrimaryButton className="self-start" data-testid="encounter-start" disabled={who.length === 0} onClick={() => addToCombat(who, state, sceneId)}>
          Start encounter
        </PrimaryButton>
        <span className="text-xs text-text-3">
          {selection.length > 0 ? `With the ${selection.length} selected.` : 'With every token on the map. Select some to start with them.'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {elsewhere && <span className="text-xs text-text-3">The encounter is running on another scene.</span>}
      <div className="flex items-center gap-1.5">
        {status === 'gathering' ? (
          <>
            <SecondaryButton data-testid="encounter-roll-npcs" onClick={() => rollForNpcs(state)}>
              Roll for NPCs
            </SecondaryButton>
            <PrimaryButton data-testid="encounter-begin" onClick={() => sendInitiative('begin')}>
              Lock the order
            </PrimaryButton>
          </>
        ) : (
          <>
            <IconKeyButton size={28} icon={ChevronLeft} label="Previous turn" shortcut="⇧N" data-testid="encounter-previous" onClick={bar.previous} />
            <span className="font-mono text-xs whitespace-nowrap text-text-2" data-testid="encounter-round">
              Round {state?.round ?? 0}
            </span>
            <PrimaryButton data-testid="encounter-next" onClick={bar.next}>
              Next
              <ChevronRight aria-hidden className="size-3.5" />
            </PrimaryButton>
          </>
        )}
        {confirmEnd ? (
          <span className="ml-auto flex items-center gap-1">
            <SecondaryButton className="text-danger" data-testid="encounter-end-confirm" onClick={() => (sendInitiative('end'), setConfirmEnd(false))}>
              End it
            </SecondaryButton>
            <SecondaryButton onClick={() => setConfirmEnd(false)}>Keep going</SecondaryButton>
          </span>
        ) : (
          <SecondaryButton className="ml-auto" data-testid="encounter-end" onClick={() => setConfirmEnd(true)}>
            End
          </SecondaryButton>
        )}
      </div>
    </div>
  );
}

function Effects({ tokens, selection }: { tokens: Token[]; selection: Token[] }) {
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState('');
  const n = parseWhole(rounds, 1, 999);
  const running = tokens.flatMap((t) => (t.effects ?? []).map((e) => ({ token: t, effect: e })));
  const add = () => {
    if (!name.trim() || n === undefined || selection.length === 0) return;
    sendTokens('set-effect', { targets: selection.map((t) => t.id), name: name.trim(), rounds: n });
    setName('');
    setRounds('');
  };
  return (
    <div className="flex flex-col gap-1">
      <Caption>Effect timers</Caption>
      <div className="flex items-center gap-1.5">
        <Input className="min-w-0 flex-1" placeholder="Bless" aria-label="Effect" data-testid="effect-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <Input className="w-14 font-mono" inputMode="numeric" placeholder="10" aria-label="Rounds" data-testid="effect-rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <SecondaryButton data-testid="effect-add" disabled={!name.trim() || n === undefined || selection.length === 0} onClick={add}>
          Add
        </SecondaryButton>
      </div>
      {running.length > 0 && (
        <ul className="flex flex-col" data-testid="effect-list">
          {running.map(({ token, effect }) => (
            <li key={`${token.id}:${effect.name}`} className="flex items-center gap-1.5 text-xs text-text-2" data-testid="effect-row">
              <span className="min-w-0 flex-1 truncate">
                {effect.name} · {token.name}
              </span>
              <span className="font-mono text-text-3">{effect.roundsLeft} rd</span>
              <IconKeyButton
                size={26}
                icon={X}
                label={`End ${effect.name} on ${token.name}`}
                onClick={() => sendTokens('set-effect', { target: token.id, name: effect.name, rounds: 0 })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EncounterBody() {
  const { tokens } = useScene();
  const selection = useSelection(tokens);
  return (
    <div className="flex flex-col gap-2.5" data-testid="encounter-body">
      <Controls />
      <div className="flex flex-col gap-1">
        <Caption>{selection.length > 0 ? `To the ${selection.length} selected` : 'To the selection'}</Caption>
        {selection.length > 0 ? (
          <>
            <HpControls targets={selection} testId="encounter" />
            <ConditionChips targets={selection} testId="encounter" />
          </>
        ) : (
          <span className="text-xs text-text-3">Pick tokens on the map (Shift+click for more than one).</span>
        )}
      </div>
      <Effects tokens={tokens} selection={selection} />
    </div>
  );
}

function OrderRow({ index }: { index: number }) {
  const state = useModuleState<InitiativeState>('initiative');
  const bar = useCombatBar();
  const chip = bar.order[index];
  const [draft, setDraft] = useState<string | null>(null);
  const entry = state?.entries[index];
  if (!chip || !entry) return null;
  const commit = () => {
    const v = draft === null ? undefined : parseWhole(draft, -99, 999);
    setDraft(null);
    if (v !== undefined && v !== entry.initiative) sendInitiative('set', { key: entry.key, value: v });
  };
  return (
    <li
      className={cn('flex items-center gap-1.5 rounded-control px-1.5 py-1', chip.current && 'ring-1 ring-inset ring-ink', chip.down && 'opacity-50')}
      data-testid="order-row"
      data-current={chip.current ? 'true' : undefined}
    >
      <Input
        className="w-12 font-mono"
        inputMode="numeric"
        aria-label={`${chip.name}'s initiative`}
        value={draft ?? (entry.initiative === null ? '' : String(entry.initiative))}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-text">{chip.name}</span>
      <IconKeyButton size={26} icon={X} label={`Remove ${chip.name}`} onClick={() => sendInitiative('remove', { key: entry.key })} />
    </li>
  );
}

export function EncounterStrip() {
  const bar = useCombatBar();
  const prepped = usePreppedEncounters(true);
  return (
    <div className="flex min-w-0 flex-1 gap-4" data-testid="encounter-strip">
      <div className="flex w-56 shrink-0 flex-col gap-1">
        <Caption>Turn order</Caption>
        {bar.order.length === 0 ? (
          <span className="text-xs text-text-3">No encounter running.</span>
        ) : (
          <ol className="flex flex-col gap-0.5 overflow-y-auto">
            {bar.order.map((c, i) => (
              <OrderRow key={c.key} index={i} />
            ))}
          </ol>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Caption>Prepped encounters</Caption>
        {prepped.length === 0 ? (
          <span className="text-xs text-text-3">No room on this scene keys an encounter.</span>
        ) : (
          <div className="flex gap-2 overflow-x-auto">
            {prepped.map((p) => (
              <div key={p.roomId} className="flex w-40 shrink-0 flex-col gap-1 rounded-control border border-line p-2" data-testid="encounter-prepped">
                <span className="truncate text-xs font-medium text-text">{p.label}</span>
                <span className="line-clamp-2 text-xs text-text-3">{p.roster}</span>
                <SecondaryButton className="self-start" disabled={!!p.inert} title={p.inert} onClick={() => spawnEncounter(p.roomId)}>
                  Spawn
                </SecondaryButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
