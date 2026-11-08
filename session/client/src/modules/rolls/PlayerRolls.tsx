// Table v2 — the player's roll surfaces (boards 5 and 20): the roll bar bottom-centre with
// its privacy (Public or To DM), the prompt card when the DM asks for a check, and the result
// chips that stand beside a roller's token for a moment.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FloatBox, Input, PrimaryButton, SecondaryButton, Seg, cn } from '@dnd/ui';
import { notify } from '@dnd/ui/toast';
import { roll as rollDice } from '@dnd/mechanics/dice';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { RollEvent, RollMode, RollsState } from '@dnd/mechanics/rolls';
import type { TokensState } from '@dnd/mechanics/tokens';
import { worldToScreen } from '../../renderer/camera';
import { lastRollTotal, myPendingEntry } from '../../session/initiativeView';
import { useModuleState, useSessionStore } from '../../session/store';
import { MODE_LABEL, PLAYER_MODES, QUICK_DICE, owedRequests, recentResults, requestTitle, rollFormula, sendRolls, tokenOfSeat, withMod, type Advantage } from './dice';

export function PlayerRollBar() {
  const [formula, setFormula] = useState('');
  const [adv, setAdv] = useState<Advantage>('none');
  const [mode, setMode] = useState<RollMode>('public');
  const roll = (f: string) => {
    if (!rollFormula(f, mode, adv)) notify.error('That is not a formula like 1d20+5.');
  };
  return (
    <FloatBox
      className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 px-2 py-1.5"
      data-testid="player-roll-bar"
      data-chrome
      role="region"
      aria-label="Roll"
    >
      <Input
        className="w-28 font-mono"
        placeholder="1d20+5"
        aria-label="Formula"
        data-testid="roll-bar-formula"
        data-roll-input
        value={formula}
        onChange={(e) => setFormula(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && formula.trim()) {
            roll(formula);
            setFormula('');
          }
        }}
      />
      {QUICK_DICE.map((d) => (
        <SecondaryButton key={d} className="font-mono" data-testid={`roll-bar-d${d}`} onClick={() => roll(`1d${d}`)}>
          d{d}
        </SecondaryButton>
      ))}
      <Seg
        aria-label="Advantage"
        value={adv}
        onValueChange={(v) => setAdv(v as Advantage)}
        options={[
          { value: 'none', label: '—' },
          { value: 'adv', label: 'Adv', testId: 'roll-bar-adv' },
          { value: 'dis', label: 'Dis', testId: 'roll-bar-dis' },
        ]}
      />
      <Seg
        aria-label="Who sees it"
        value={mode}
        onValueChange={(v) => setMode(v as RollMode)}
        options={PLAYER_MODES.map((m) => ({ value: m, label: MODE_LABEL[m], testId: `roll-bar-mode-${m}` }))}
      />
    </FloatBox>
  );
}

/** The DM asked for a check: one card per request this seat still owes, Roll sends the answer. */
export function RollPromptCard() {
  const rolls = useModuleState<RollsState>('rolls');
  const you = useSessionStore((s) => s.you?.identityId);
  const [mod, setMod] = useState('');
  const owed = owedRequests(rolls, you);
  const req = owed.at(-1);
  if (!req) return null;
  const m = Number(mod);
  const answer = () => sendRolls('roll-result', { requestId: req.id, formula: withMod(20, Number.isInteger(m) ? m : 0) });
  return (
    <FloatBox
      className="absolute bottom-20 left-1/2 z-30 flex w-72 -translate-x-1/2 flex-col gap-2 px-3 py-2.5"
      data-testid="roll-prompt"
      data-chrome
      role="dialog"
      aria-label={requestTitle(req)}
    >
      <span className="text-xs text-text-3">The DM asks for a roll</span>
      <span className="text-sm font-medium text-text" data-testid="roll-prompt-title">
        {requestTitle(req)}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-text-2">1d20 +</span>
        <Input className="w-14 font-mono" inputMode="numeric" placeholder="0" aria-label="Modifier" data-testid="roll-prompt-mod" value={mod} onChange={(e) => setMod(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <PrimaryButton className="ml-auto" data-testid="roll-prompt-roll" onClick={answer}>
          Roll
        </PrimaryButton>
      </div>
      {owed.length > 1 && <span className="text-xs text-text-3">{owed.length - 1} more after this one</span>}
    </FloatBox>
  );
}

/** One chip, kept beside its token as the camera moves. */
function Chip({ event, x, y }: { event: RollEvent; x: number; y: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const step = () => {
      const el = ref.current;
      const at = worldToScreen(x, y);
      if (el && at) {
        el.style.left = `${at.x}px`;
        el.style.top = `${at.y}px`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [x, y]);
  const nat = /^1d20/.test(event.formula ?? '') ? event.breakdown?.split(' ')[0] : undefined;
  return (
    <span
      ref={ref}
      style={{ visibility: 'hidden' }}
      className={cn(
        'pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-pill border border-line bg-panel px-2 py-0.5 font-mono text-xs text-text shadow-e',
        (nat === '20' || nat === '1') && 'ring-1 ring-ink',
      )}
      data-testid="roll-chip"
      title={[event.title, event.formula, event.breakdown].filter(Boolean).join(' · ')}
    >
      {event.total}
    </span>
  );
}

/** Each roll with a total from the last few seconds, beside the roller's token. */
export function RollChips() {
  const rolls = useModuleState<RollsState>('rolls');
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const [now, setNow] = useState(() => Date.now());
  // A roll newer than `now` counts as fresh, so it shows the moment it lands; the tick drops it.
  const recent = recentResults(rolls?.log, now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {recent.flatMap((e) => {
        const token = tokenOfSeat(tokens, sceneId, e.identityId);
        return token ? [<Chip key={e.id} event={e} x={token.x} y={token.y - 0.6} />] : [];
      })}
    </>
  );
}

/**
 * "Roll for initiative" — the player's card while the DM gathers the order, for the combatant
 * that is theirs and still has no number. Leaves on its own the moment the entry fills, from
 * wherever it was filled (this card, a Beyond20 roll, the DM).
 */
export function InitiativePromptCard() {
  const state = useModuleState<InitiativeState>('initiative');
  const rolls = useModuleState<RollsState>('rolls');
  const you = useSessionStore((s) => s.you?.identityId);
  const [draft, setDraft] = useState('');
  const entry = myPendingEntry(state, you);
  const last = lastRollTotal(rolls, you);
  if (!entry) return null;
  const set = (value: number) => {
    useSessionStore.getState().sendCommand('initiative', 'set', { key: entry.key, value });
    setDraft('');
  };
  const typed = Number(draft);
  return (
    <FloatBox
      className="absolute bottom-36 left-1/2 z-30 flex w-80 -translate-x-1/2 items-center gap-2 px-3 py-2"
      data-testid="initiative-prompt"
      data-chrome
      role="dialog"
      aria-label="Roll for initiative"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-text">Roll for initiative</span>
        <span className="truncate text-xs text-text-3">{entry.name}</span>
      </span>
      {last !== undefined && (
        <SecondaryButton data-testid="initiative-prompt-last" onClick={() => set(last)}>
          Last roll {last}
        </SecondaryButton>
      )}
      <SecondaryButton data-testid="initiative-prompt-roll" onClick={() => set(rollDice('1d20').total)}>
        d20
      </SecondaryButton>
      <Input
        className="w-14 font-mono"
        inputMode="numeric"
        aria-label={`Initiative for ${entry.name}`}
        data-testid="initiative-prompt-value"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && draft.trim() && Number.isFinite(typed)) set(typed);
        }}
      />
    </FloatBox>
  );
}
