// The Initiative popover — the one widget that replaces both of today's "Initiative"
// sections (the read-only tracker and the DM's SessionControls bookkeeping block). Same
// server module, same commands (`start`/`set`/`begin`/`next`/`add`/`remove`/`hp`/`damage`/
// `condition`/`end`), one component both seats render, redaction already done by the wire.
//
// Idle → a DM candidate checklist with one footer "Begin"; gathering/running → turn-ordered
// rows with a bookkeeping line on whichever row is selected. Past the no-scroll ledger's
// ceiling the rows densify, then the popover widens into two columns (see the constants below).

import { useMemo, useState } from 'react';
import {
  CONDITIONS,
  HP_MAX,
  conditionLabel,
  ordered,
  type InitiativeEntry,
  type InitiativeState,
} from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
import { combatantCandidates, myPendingEntry } from '../../session/initiativeView';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useRole, useSessionStore } from '../../session/store';
import { Icon } from '../../shell/icons';
import { useInitiativeSelection } from './selection';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('initiative', action, payload);

// No-scroll ledger (docs/2026-08-22-table-shell-plan.md): 14 rows at 36px fit with header
// and footer. Past that the rows compact and conditions collapse to a count; past 24 the
// popover widens and splits into two columns. Nobody at a real table needs more than 40.
const DENSE_AT = 14;
const WIDE_AT = 24;
const HARD_CAP = 40;

const BTN_BASE =
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded border px-2.5 text-xs font-medium transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';
const BTN_PRIMARY = `${BTN_BASE} border-accent-active bg-accent-active text-on-accent hover:bg-accent-active/90`;
const BTN_GHOST = `${BTN_BASE} border-transparent bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary`;
const BTN_GHOST_DANGER = `${BTN_BASE} border-transparent bg-transparent text-danger hover:bg-surface-2`;
const INPUT =
  'h-7 rounded border border-border-default bg-surface-0 px-2 text-[13px] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';
const COND_CHIP =
  'shrink-0 rounded border border-border-default px-1 text-[9px] uppercase tracking-[.06em] text-text-secondary';

/** Raw module state, read outside React — what `subtitle`/`badge`/`width` all need. */
function rawState(): InitiativeState | undefined {
  return useSessionStore.getState().session?.modules.initiative as InitiativeState | undefined;
}

function initiativeSubtitle(): string | null {
  const state = rawState();
  if (!state || state.status === 'idle') return null;
  const n = state.entries.length;
  return state.status === 'running' ? `Round ${state.round} · ${n} combatants` : `Rolling · ${n} combatants`;
}

/**
 * The rail's corner badge. DM: the round number, so glancing at the rail says how far the
 * fight has gone. Player (M3 review finding 13, "green budget" — the accent is for *your*
 * turn, not table bookkeeping): a bare turn marker only while it is actually their turn, the
 * same glyph the row itself uses, never the round count.
 */
function initiativeBadge(): string | null {
  const state = rawState();
  if (state?.status !== 'running') return null;
  if (useSessionStore.getState().you?.role !== 'player') return `R${state.round}`;
  const identityId = useSessionStore.getState().you?.identityId;
  const isMyTurn = state.entries[state.turn]?.identityId === identityId;
  return isMyTurn ? '▶' : null;
}

function initiativeWidth(): 320 | 360 {
  return (rawState()?.entries.length ?? 0) > WIDE_AT ? 360 : 320;
}

function splitHalf<T>(items: readonly T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

function focusInitiativePrompt(): void {
  document.querySelector<HTMLInputElement>('[data-testid="initiative-prompt"] input')?.focus();
}

/**
 * Damage, conditions and (for a pool not yet set) max HP — the second line a selected row
 * opens. Inputs only; the numbers and chips themselves are read off the row above, which
 * both seats share, so this line never repeats what is already on screen.
 */
function Bookkeeping({ entry }: { entry: InitiativeEntry }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const has = entry.conditions ?? [];
  const available = CONDITIONS.filter((c) => !has.includes(c));

  return (
    <div className="ml-6 flex flex-wrap items-center gap-1.5 rounded-b bg-surface-3 px-2 py-1.5">
      <span className="text-[11px] text-text-muted">Damage</span>
      <input
        type="number"
        title="Damage taken — a negative number heals"
        aria-label={`Damage to ${entry.name}`}
        data-testid="initiative-damage"
        disabled={!entry.hp}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const amount = Number(e.currentTarget.value);
          if (Number.isInteger(amount) && amount !== 0) {
            send('damage', { key: entry.key, amount });
            e.currentTarget.value = '';
          }
        }}
        className={`${INPUT} w-16 disabled:opacity-40`}
      />
      <span className="text-[11px] text-text-muted">neg. heals</span>

      {!entry.hp && (
        <input
          type="number"
          min={1}
          max={HP_MAX}
          placeholder="Set max HP"
          aria-label={`Max HP for ${entry.name}`}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const max = Number(e.currentTarget.value);
            if (Number.isInteger(max) && max > 0) send('hp', { key: entry.key, max });
          }}
          className={`${INPUT} w-[92px]`}
        />
      )}

      <span className="flex-1" />

      {has.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => send('condition', { key: entry.key, name: c, on: false })}
          className="shrink-0 rounded border border-accent-dim px-1.5 py-0.5 text-[9px] uppercase tracking-[.06em] text-accent-active hover:bg-surface-1"
        >
          {conditionLabel(c)}
        </button>
      ))}

      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-label="Add a condition"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-5 w-6 shrink-0 items-center justify-center rounded border border-border-default text-text-secondary hover:bg-surface-1"
      >
        <Icon name="plus" size={11} />
      </button>

      {/* M3 finding 7 — inline, not an absolutely-positioned dropdown: the popover body clips
          `overflow-hidden`, so a menu near the top used to render off-screen. Rendering the
          available conditions as ordinary chips lets the bookkeeping line's own `flex-wrap`
          push them onto a second row instead — clip-proof by construction. */}
      {menuOpen &&
        available.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              send('condition', { key: entry.key, name: c, on: true });
              setMenuOpen(false);
            }}
            className="shrink-0 rounded border border-dashed border-border-default px-1.5 py-0.5 text-[9px] uppercase tracking-[.04em] text-text-secondary hover:bg-surface-2"
          >
            {conditionLabel(c)}
          </button>
        ))}
    </div>
  );
}

/**
 * One combatant. HP is redacted at the wire already (server `initiative` module) — this
 * only decides how much of what arrived a *player* seat still prints: full numbers for
 * their own combatant, the bar alone for anyone else (an NPC's live pool never reaches a
 * player at all; only its "down" bit does), the DM sees everything regardless.
 */
function Row({
  entry,
  isCurrent,
  isOwn,
  isDm,
  dense,
  selected,
  onSelect,
}: {
  entry: InitiativeEntry;
  isCurrent: boolean;
  isOwn: boolean;
  isDm: boolean;
  dense: boolean;
  selected: boolean;
  onSelect: (key: string | null) => void;
}) {
  const hp = entry.hp;
  const down = !!hp && hp.current === 0;
  let hpText: string | null = null;
  let barPct: number | null = null;
  if (hp) {
    if (hp.max === 0) {
      hpText = 'down'; // redacted NPC — no real pool, so no bar either
    } else {
      barPct = Math.round((hp.current / hp.max) * 100);
      if (isDm || isOwn) hpText = `${hp.current}/${hp.max}`;
    }
  }
  const conditions = entry.conditions ?? [];
  const clickable = isDm;
  const highlighted = isCurrent || selected;

  // The name + chips + hp block, shared by the clickable (DM) and inert (player) renders —
  // finding 13: this lives inside a real `<button>` now, never a `role="button"` div, so the
  // initiative-number input beside it (a sibling, not a descendant) is never nested inside
  // anything with button semantics.
  const rowInner = (
    <>
      <span className="w-2.5 shrink-0 text-center text-[10px] text-accent-active">{isCurrent ? '▶' : ''}</span>
      <span className={`min-w-0 flex-1 truncate text-left ${down ? 'text-text-muted line-through' : 'text-text-primary'}`}>
        {entry.name}
        {isOwn && <span className="ml-1 text-xs font-normal text-text-muted">(you)</span>}
      </span>

      {conditions.length > 0 &&
        (dense ? (
          <span className={COND_CHIP}>+{conditions.length}</span>
        ) : (
          conditions.map((c) => (
            <span key={c} className={COND_CHIP}>
              {conditionLabel(c)}
            </span>
          ))
        ))}

      <span
        aria-label={hpText ? `HP ${hpText}` : barPct !== null ? `HP ${barPct}%` : undefined}
        className={`ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs ${
          down ? 'text-text-muted' : 'text-text-secondary'
        }`}
      >
        {hpText && <span>{hpText}</span>}
        {barPct !== null && (
          <span className="h-[3px] w-9 shrink-0 overflow-hidden rounded-full bg-surface-3">
            <span
              className={`block h-full rounded-full ${barPct <= 25 ? 'bg-danger' : 'bg-text-secondary'}`}
              style={{ width: `${barPct}%` }}
            />
          </span>
        )}
      </span>
    </>
  );

  return (
    <>
      <li
        data-testid={`initiative-row-${entry.key}`}
        className={`flex items-center gap-1.5 rounded px-2 text-[13px] transition-colors duration-150 ease-settle motion-reduce:transition-none ${
          dense ? 'h-7' : 'h-9'
        } ${highlighted ? 'bg-surface-3' : ''}`}
      >
        {clickable ? (
          <button
            type="button"
            aria-current={isCurrent ? 'true' : undefined}
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : entry.key)}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {rowInner}
          </button>
        ) : (
          <div aria-current={isCurrent ? 'true' : undefined} className="flex h-full min-w-0 flex-1 items-center gap-1.5">
            {rowInner}
          </div>
        )}

        {selected && isDm ? (
          <input
            key={`${entry.key}:${entry.initiative}`}
            type="number"
            defaultValue={entry.initiative ?? ''}
            aria-label={`Initiative for ${entry.name}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (e.target.value.trim() && Number.isFinite(value) && value !== entry.initiative) {
                send('set', { key: entry.key, value });
              }
            }}
            className="h-6 w-9 shrink-0 rounded border border-border-default bg-surface-1 px-1 text-right font-mono text-[13px] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
        ) : (
          <span
            className={`w-6 shrink-0 text-right font-mono text-[13px] font-medium ${
              down ? 'text-text-muted' : 'text-text-dim'
            }`}
          >
            {entry.initiative ?? '—'}
          </span>
        )}
      </li>
      {selected && isDm && (
        <li className="list-none">
          <Bookkeeping entry={entry} />
        </li>
      )}
    </>
  );
}

function AddCombatantRow() {
  const [name, setName] = useState('');
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        // No token: a reinforcement the DM names mid-fight is off-board until placed.
        send('add', { name: trimmed, kind: 'npc' });
        setName('');
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a combatant"
        aria-label="Add a combatant"
        maxLength={60}
        className={`${INPUT} min-w-0 flex-1`}
      />
      <button type="submit" data-testid="initiative-add" disabled={!name.trim()} className={BTN_GHOST}>
        Add
      </button>
    </form>
  );
}

export function InitiativePanel() {
  const state = useModuleState<InitiativeState>('initiative');
  const tokensState = useModuleState<TokensState>('tokens');
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const role = useRole();
  const identityId = useSessionStore((s) => s.you?.identityId);
  const isDm = role === 'dm';

  const selectedKey = useInitiativeSelection((s) => s.selectedKey);
  const select = useInitiativeSelection((s) => s.select);
  const picked = useInitiativeSelection((s) => s.picked);
  const togglePicked = useInitiativeSelection((s) => s.togglePicked);

  const candidates = useMemo(
    () => combatantCandidates(tokensState, activeSceneId),
    [tokensState, activeSceneId],
  );

  const wrap = (children: React.ReactNode) => (
    <div data-testid="initiative-panel" className="flex min-h-0 flex-1 flex-col gap-2">
      {children}
    </div>
  );

  if (!state || state.status === 'idle') {
    if (!isDm) return wrap(<p className="text-sm text-text-muted">No encounter running.</p>);
    if (!activeSceneId) {
      return wrap(<p className="text-sm text-text-muted">Activate a scene to start an encounter.</p>);
    }
    if (candidates.length === 0) {
      return wrap(<p className="text-sm text-text-muted">No tokens on this scene yet.</p>);
    }
    return wrap(
      <ul data-testid="initiative-candidates" className="flex flex-col gap-0.5">
        {candidates.map((c) => {
          const checked = picked[c.tokenId] ?? c.kind === 'pc';
          return (
            <li key={c.tokenId}>
              <label className="flex h-7 items-center gap-2 rounded px-2 text-sm text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 motion-reduce:transition-none">
                <input type="checkbox" checked={checked} onChange={() => togglePicked(c.tokenId, c.kind === 'pc')} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-text-muted">{c.kind === 'pc' ? 'Player' : 'NPC'}</span>
              </label>
            </li>
          );
        })}
      </ul>,
    );
  }

  // A player only sees the fight when it is on the scene they are looking at — the DM's own
  // controls stay reachable from anywhere (they might `end` or adjust it from prep).
  if (!isDm && (!activeSceneId || state.sceneId !== activeSceneId)) {
    return wrap(<p className="text-sm text-text-muted">No encounter running.</p>);
  }

  const running = state.status === 'running';
  const entries = running ? state.entries : ordered(state.entries);
  const dense = entries.length > DENSE_AT;
  const wide = entries.length > WIDE_AT;
  const overflow = Math.max(0, entries.length - HARD_CAP);
  const indexed = entries.slice(0, HARD_CAP).map((entry, i) => ({ entry, i }));

  const rowFor = ({ entry, i }: { entry: InitiativeEntry; i: number }) => (
    <Row
      key={entry.key}
      entry={entry}
      isCurrent={running && i === state.turn}
      isOwn={!!identityId && entry.identityId === identityId}
      isDm={isDm}
      dense={dense}
      selected={isDm && selectedKey === entry.key}
      onSelect={select}
    />
  );

  return wrap(
    <>
      {wide ? (
        <div data-testid="initiative-rows" className="grid grid-cols-2 gap-x-2">
          {splitHalf(indexed).map((col, ci) => (
            <ul key={ci} className="flex flex-col gap-0.5">
              {col.map(rowFor)}
            </ul>
          ))}
        </div>
      ) : (
        <ul data-testid="initiative-rows" className="flex flex-col gap-0.5">
          {indexed.map(rowFor)}
        </ul>
      )}
      {overflow > 0 && <p className="px-2 text-xs text-text-muted">+{overflow} more</p>}
      {isDm && <AddCombatantRow />}
    </>,
  );
}

export function InitiativeFooter() {
  const state = useModuleState<InitiativeState>('initiative');
  const tokensState = useModuleState<TokensState>('tokens');
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const role = useRole();
  const identityId = useSessionStore((s) => s.you?.identityId);
  const picked = useInitiativeSelection((s) => s.picked);

  if (role === 'dm') {
    if (!state || state.status === 'idle') {
      const candidates = combatantCandidates(tokensState, activeSceneId);
      const chosen = candidates.filter((c) => picked[c.tokenId] ?? c.kind === 'pc');
      return (
        <button
          type="button"
          data-testid="initiative-begin"
          disabled={chosen.length === 0}
          onClick={() =>
            send('start', {
              sceneId: activeSceneId,
              // `tokenId` rides on every entry: the turn ring on the map has nothing else
              // to find the combatant's token by.
              entries: chosen.map(({ tokenId, name, kind, identityId: id }) => ({
                tokenId,
                name,
                kind,
                ...(id ? { identityId: id } : {}),
              })),
            })
          }
          className={`${BTN_PRIMARY} ml-auto`}
        >
          Begin
        </button>
      );
    }

    const running = state.status === 'running';
    return (
      <>
        <button
          type="button"
          data-testid="initiative-end"
          onClick={() => send('end', {})}
          className={BTN_GHOST_DANGER}
        >
          End encounter
        </button>
        <span className="flex-1" />
        <button
          type="button"
          data-testid={running ? 'initiative-next' : 'initiative-begin'}
          onClick={() => send(running ? 'next' : 'begin', {})}
          className={BTN_PRIMARY}
        >
          {running ? (
            <>
              Next turn{' '}
              <kbd className="ml-0.5 rounded border border-on-accent/35 px-1 font-mono text-[10px] text-inherit">
                N
              </kbd>
            </>
          ) : (
            'Begin'
          )}
        </button>
      </>
    );
  }

  // Player: a status line naming their own turn, and — only while they still owe the table
  // a number — a way to jump back to the prompt they may have dismissed the focus of.
  if (!state || state.status === 'idle') return null;
  const running = state.status === 'running';
  const entries = running ? state.entries : ordered(state.entries);
  const myIndex = entries.findIndex((e) => e.identityId === identityId);
  const isMyTurn = running && myIndex === state.turn;
  const nextIndex = running && entries.length > 0 ? (state.turn + 1) % entries.length : -1;
  const isUpNext = !isMyTurn && running && myIndex === nextIndex;
  const label = isMyTurn ? 'Your turn.' : isUpNext ? "You're up next." : null;
  const pending = myPendingEntry(state, identityId);

  return (
    <>
      {label && <span className="text-xs text-text-muted">{label}</span>}
      <span className="flex-1" />
      {pending && (
        <button type="button" onClick={focusInitiativePrompt} className={BTN_GHOST}>
          Roll initiative
        </button>
      )}
    </>
  );
}

registerPanel({
  id: 'initiative',
  title: 'Initiative',
  icon: 'initiative',
  key: 'I',
  group: 'play',
  roles: ALL_ROLES,
  order: 10,
  component: InitiativePanel,
  footer: InitiativeFooter,
  subtitle: initiativeSubtitle,
  badge: initiativeBadge,
  width: initiativeWidth,
});
