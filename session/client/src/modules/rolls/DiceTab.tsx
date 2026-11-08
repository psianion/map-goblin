// Table v2 — the DM dock's Dice tab (board 20). Left: quick dice, a formula, advantage, the
// mode (Public, To DM, GM only, Blind) and Ask players for a check. Right: the open request
// cards with each answer as it lands, pass or fail against the DC, Share results and the
// quick condition for a fail; rollable tables; saved rolls.

import { useMemo, useState } from 'react';
import { Caption, Chip, Input, PrimaryButton, SecondaryButton, Seg, SelectRow, IconKeyButton, cn } from '@dnd/ui';
import { notify } from '@dnd/ui/toast';
import { X } from '@dnd/ui/icons';
import type { RollMode, RollRequest, RollsState } from '@dnd/mechanics/rolls';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { CATALOGUE, conditionLabel, parseWhole, sendTokens } from '../tokens/play';
import {
  CHECKS,
  MODE_LABEL,
  QUICK_DICE,
  checkLabel,
  parseTableRows,
  requestTitle,
  rollFormula,
  sendRolls,
  tokenOfSeat,
  useDiceSettings,
  verdict,
  type Advantage,
} from './dice';

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

export function DiceBody() {
  const { mode, adv, set } = useDiceSettings();
  const [formula, setFormula] = useState('');
  const players = useSessionStore((s) => s.session?.players ?? []).filter((p) => p.role === 'player');
  const [targets, setTargets] = useState<string[] | null>(null);
  const [check, setCheck] = useState('perception');
  const [dc, setDc] = useState('');

  const rollTyped = () => {
    if (!rollFormula(formula, mode, adv)) return notify.error('That is not a formula like 1d20+5.');
    setFormula('');
  };
  const ask = () => {
    const dcValue = parseWhole(dc, 1, 99);
    sendRolls('request', {
      targets: targets ?? 'all',
      label: `${checkLabel(check)} check`,
      ability: check,
      ...(dcValue !== undefined ? { dc: dcValue } : {}),
    });
  };
  const toggleTarget = (id: string) => {
    const now = targets ?? [];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    setTargets(next.length === 0 ? null : next);
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="dice-body">
      <div className="flex flex-wrap gap-1">
        {QUICK_DICE.map((d) => (
          <SecondaryButton key={d} className="font-mono" data-testid={`dice-d${d}`} onClick={() => rollFormula(`1d${d}`, mode, adv)}>
            d{d}
          </SecondaryButton>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          className="min-w-0 flex-1 font-mono"
          placeholder="2d6+3"
          aria-label="Formula"
          data-testid="dice-formula"
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === 'Enter') rollTyped();
          }}
        />
        <PrimaryButton data-testid="dice-roll" onClick={rollTyped}>
          Roll
        </PrimaryButton>
      </div>
      <Seg
        aria-label="Advantage"
        value={adv}
        onValueChange={(v) => set({ adv: v as Advantage })}
        options={[
          { value: 'none', label: 'Normal', testId: 'dice-adv-none' },
          { value: 'adv', label: 'Adv', testId: 'dice-adv-adv' },
          { value: 'dis', label: 'Dis', testId: 'dice-adv-dis' },
        ]}
      />
      <Seg
        aria-label="Who sees it"
        value={mode}
        onValueChange={(v) => set({ mode: v as RollMode })}
        options={(Object.keys(MODE_LABEL) as RollMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], testId: `dice-mode-${m}` }))}
      />
      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <Caption>Ask players for a check</Caption>
        <div className="flex flex-wrap gap-1">
          <Chip pressed={targets === null} data-testid="ask-target-all" onPressedChange={() => setTargets(null)}>
            All players
          </Chip>
          {players.map((p) => (
            <Chip key={p.identityId} pressed={!!targets?.includes(p.identityId)} data-testid={`ask-target-${p.identityId}`} onPressedChange={() => toggleTarget(p.identityId)}>
              {p.name}
            </Chip>
          ))}
        </div>
        <SelectRow label="Check" value={check} options={CHECKS.map((c) => ({ value: c.id, label: c.label }))} onValueChange={setCheck} />
        <div className="flex items-center gap-1.5">
          <Input className="w-16 font-mono" inputMode="numeric" placeholder="DC" aria-label="DC" data-testid="ask-dc" value={dc} onChange={(e) => setDc(e.target.value)} onKeyDown={stop} />
          <PrimaryButton data-testid="ask-send" disabled={players.length === 0} onClick={ask}>
            Send
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function RequestCard({ req }: { req: RollRequest }) {
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players ?? []);
  const [onFail, setOnFail] = useState<string>('restrained');
  const asked = req.targets ?? players.filter((p) => p.role === 'player').map((p) => p.identityId);
  const waiting = asked.filter((id) => !req.results.some((r) => r.identityId === id));
  return (
    <div className="flex w-60 shrink-0 flex-col gap-1.5 rounded-control border border-line p-2" data-testid="request-card">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{requestTitle(req)}</span>
        <IconKeyButton size={26} icon={X} label="Close request" onClick={() => sendRolls('close-request', { requestId: req.id })} />
      </div>
      <ul className="flex flex-col gap-0.5">
        {req.results.map((r) => {
          const v = verdict(req, r.total);
          const token = tokenOfSeat(tokens, sceneId, r.identityId);
          return (
            <li key={r.identityId} className="flex items-center gap-1.5 text-xs" data-testid="request-result">
              <span className="min-w-0 flex-1 truncate text-text-2">{r.playerName}</span>
              <span className="font-mono text-text">{r.total}</span>
              {v && <span className={cn('w-8 text-right', v === 'fail' ? 'text-danger' : 'text-text-3')}>{v}</span>}
              {v === 'fail' && token && (
                <SecondaryButton
                  data-testid="request-apply"
                  onClick={() => sendTokens('set-condition', { target: token.id, name: onFail, on: true })}
                >
                  Apply {conditionLabel(onFail)} to {token.name}
                </SecondaryButton>
              )}
            </li>
          );
        })}
        {waiting.map((id) => (
          <li key={id} className="text-xs text-text-3">
            {players.find((p) => p.identityId === id)?.name ?? 'A player'}: waiting
          </li>
        ))}
      </ul>
      {req.dc !== undefined && req.results.some((r) => verdict(req, r.total) === 'fail') && (
        <SelectRow label="On a fail" value={onFail} options={CATALOGUE.map((c) => ({ value: c, label: conditionLabel(c) }))} onValueChange={setOnFail} />
      )}
      <SecondaryButton className="self-start" data-testid="request-share" disabled={req.results.length === 0 || req.shared} onClick={() => sendRolls('share-request', { requestId: req.id })}>
        {req.shared ? 'Shared' : 'Share results'}
      </SecondaryButton>
    </div>
  );
}

function Tables({ state }: { state: RollsState | undefined }) {
  const mode = useDiceSettings((s) => s.mode);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [die, setDie] = useState('1d20');
  const [rows, setRows] = useState('');
  const save = () => {
    const parsed = parseTableRows(rows);
    if (!name.trim() || parsed.length === 0) return notify.error('A table needs a name and at least one row like "1-10 Nothing".');
    sendRolls('table-upsert', { name: name.trim(), die: die.replace(/\s+/g, ''), rows: parsed });
    setAdding(false);
    setName('');
    setRows('');
  };
  return (
    <div className="flex w-56 shrink-0 flex-col gap-1">
      <Caption>Rollable tables</Caption>
      {(state?.tables ?? []).map((t) => (
        <div key={t.id} className="flex items-center gap-1.5 text-xs" data-testid="roll-table">
          <span className="min-w-0 flex-1 truncate text-text">{t.name}</span>
          <span className="font-mono text-text-3">{t.die}</span>
          <SecondaryButton data-testid="roll-table-roll" onClick={() => sendRolls('roll-table', { id: t.id, mode })}>
            Roll
          </SecondaryButton>
        </div>
      ))}
      {adding ? (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <Input className="min-w-0 flex-1" placeholder="Name" aria-label="Table name" data-testid="table-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={stop} />
            <Input className="w-16 font-mono" aria-label="Die" value={die} onChange={(e) => setDie(e.target.value)} onKeyDown={stop} />
          </div>
          <textarea
            className="h-16 rounded-control border border-line bg-panel px-2 py-1 font-mono text-xs text-text"
            placeholder={'1-10 Nothing\n11-20 A wandering ogre'}
            aria-label="Rows"
            data-testid="table-rows"
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            onKeyDown={stop}
          />
          <div className="flex gap-1">
            <PrimaryButton data-testid="table-save" onClick={save}>
              Save
            </PrimaryButton>
            <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
          </div>
        </div>
      ) : (
        <SecondaryButton className="self-start" data-testid="table-new" onClick={() => setAdding(true)}>
          New table
        </SecondaryButton>
      )}
    </div>
  );
}

function Saved({ state }: { state: RollsState | undefined }) {
  const { mode, adv } = useDiceSettings();
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const save = () => {
    if (!name.trim() || !formula.trim()) return;
    sendRolls('saved-upsert', { name: name.trim(), formula: formula.replace(/\s+/g, '') });
    setName('');
    setFormula('');
  };
  return (
    <div className="flex w-56 shrink-0 flex-col gap-1">
      <Caption>Saved rolls</Caption>
      {(state?.saved ?? []).map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 text-xs" data-testid="saved-roll">
          <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
          <span className="font-mono text-text-3">{s.formula}</span>
          <SecondaryButton data-testid="saved-roll-roll" onClick={() => rollFormula(s.formula, mode, adv, s.name)}>
            Roll
          </SecondaryButton>
          <IconKeyButton size={26} icon={X} label={`Delete ${s.name}`} onClick={() => sendRolls('saved-delete', { id: s.id })} />
        </div>
      ))}
      <div className="flex gap-1">
        <Input className="min-w-0 flex-1" placeholder="Goblin attack" aria-label="Saved roll name" data-testid="saved-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={stop} />
        <Input className="w-20 font-mono" placeholder="1d20+4" aria-label="Saved roll formula" data-testid="saved-formula" value={formula} onChange={(e) => setFormula(e.target.value)} onKeyDown={stop} />
        <SecondaryButton data-testid="saved-add" onClick={save}>
          Add
        </SecondaryButton>
      </div>
    </div>
  );
}

export function DiceStrip() {
  const state = useModuleState<RollsState>('rolls');
  const requests = useMemo(() => [...(state?.requests ?? [])].reverse(), [state?.requests]);
  return (
    <div className="flex min-w-0 flex-1 gap-4 overflow-x-auto" data-testid="dice-strip">
      <div className="flex shrink-0 gap-2">
        {requests.length === 0 ? (
          <div className="flex w-40 flex-col gap-1">
            <Caption>Requests</Caption>
            <span className="text-xs text-text-3">Ask players for a check to see their results here.</span>
          </div>
        ) : (
          requests.map((r) => <RequestCard key={r.id} req={r} />)
        )}
      </div>
      <Tables state={state} />
      <Saved state={state} />
    </div>
  );
}
