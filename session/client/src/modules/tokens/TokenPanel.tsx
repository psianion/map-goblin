// §2.4.8 — the shared token panel: what is on this scene, what you have selected, and
// the claim affordance. It is also where the Pixi overlay is mounted from, because a
// panel is this module's only React lifecycle (D8) and the engine is only ready some time
// after boot (§4).

import { useEffect, useMemo, useState } from 'react';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { showToast } from '../../session/toasts';
import { liveSceneDoors } from '../doors/DoorRenderer';
import { tokenRefusal, useTokenInteraction } from './drag';
import {
  DEFAULT_LIGHT,
  DEFAULT_SIGHT,
  VISION_MODES,
  mapScale,
  toCells,
  toUnits,
  type Light,
  type MapScale,
  type Sight,
} from './sight';
import { mountTokenLayerWhenReady, tokensOf } from './TokenRenderer';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

/**
 * Turns the server's refusal into the one toast the table has — the doors lane's
 * `useDoorFeedback`, for the move a player is not allowed to make. Without it the only
 * feedback is the 600ms rubber-band in `TokenRenderer`, which reads as a dropped frame
 * rather than as an answer.
 *
 * Only the seat that sent the move ever sees it: a refusal reaches the sender alone
 * (`CommandRouter`), and the DM is refused by none of this (`canOccupy` passes the DM).
 */
function useTokenFeedback(): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    // The doors this seat holds, read at refusal time rather than subscribed to: the name
    // is wanted once, for the sentence, and a door list is not a reason to re-toast.
    const message = tokenRefusal(lastError.message, liveSceneDoors());
    // One toast per rejected drop, not one per refused message: a drag across a wall is
    // refused at ~10 Hz on the way and again on the drop, and the last throttled move can
    // land after the pointer is already up. An accepted move raises no error at all, so a
    // slow echo (the case the rubber-band also fires on) stays silent.
    //
    // The de-duplication is `useToasts.show`'s, not this hook's: it keeps the one toast but
    // restarts its window, so the refusal a player reads on the drop is not one already
    // most of the way through its life because the drag tripped it seconds earlier.
    if (!message) return;
    showToast({ message });
  }, [lastError]);
}

// ── P4 §3/§4 — Sight & light, and who this token shares it with ────────────
// DM-only, and that is enforced on the server rather than by hiding the controls: `sight` and
// `light` are in `UPDATE_FIELDS`, which a non-DM may not touch even on a token they own. The
// panel below is simply never rendered for them.

const numberInput =
  'w-14 min-w-0 rounded border border-border-default bg-surface-1 px-1 py-0.5 text-right text-xs tabular-nums text-text-primary focus:border-border-focus focus:outline-none';
const unitLabel = 'shrink-0 text-[11px] text-text-muted';
const quietButton =
  'shrink-0 rounded-chip border border-border-default px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none';

/**
 * A range field that commits on blur or Enter, never per keystroke.
 *
 * Every `tokens update` is an auto-explore trigger — a full sweep for the party and a fog
 * broadcast to the table — so a DM typing "30" would fire three of them, and the middle of
 * "30" is 3. Worse, an emptied field reads `NaN`, which committed as 0: sight range zero
 * collapses every player's mask while the DM is still typing. So the draft lives here, and
 * a draft that is not a number is discarded rather than sent — the field snaps back to the
 * last value the token actually has, which is the one the table is still playing on.
 */
function RangeField({
  label,
  testId,
  value,
  step,
  onCommit,
}: {
  label: string;
  testId: string;
  value: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = Number(draft);
    if (draft !== null && draft.trim() !== '' && Number.isFinite(next)) onCommit(Math.max(0, next));
    setDraft(null);
  };
  return (
    <input
      type="number"
      min={0}
      step={step}
      aria-label={label}
      data-testid={testId}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      // Enter commits from the keyboard. It cannot double-send with the blur that follows:
      // committing clears the draft, and a commit with no draft is a no-op.
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={numberInput}
    />
  );
}

/** A labelled row with the field's own "give it one" / "take it away" affordance on the right. */
function NullableField({
  label,
  testId,
  present,
  onAdd,
  onClear,
  children,
}: {
  label: string;
  testId: string;
  present: boolean;
  onAdd: () => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-secondary">{label}</span>
        <button
          type="button"
          data-testid={present ? `${testId}-clear` : `${testId}-add`}
          onClick={present ? onClear : onAdd}
          className={quietButton}
        >
          {present ? 'None' : 'Add'}
        </button>
      </div>
      {present && children}
    </div>
  );
}

function SightAndLight({
  token,
  tokens,
  scale,
  send,
}: {
  token: Token;
  tokens: readonly Token[];
  scale: MapScale;
  send: (action: string, payload: unknown) => void;
}) {
  const [linking, setLinking] = useState('');
  const update = (fields: Record<string, unknown>) => send('update', { id: token.id, ...fields });
  const setSight = (patch: Partial<Sight>) =>
    update({ sight: { ...(token.sight ?? DEFAULT_SIGHT), ...patch } });
  const setLight = (patch: Partial<Light>) =>
    update({ light: { ...(token.light ?? DEFAULT_LIGHT), ...patch } });

  const links = token.sharesSightWith ?? [];
  const linkable = tokens.filter((t) => t.id !== token.id && !links.includes(t.id));
  const link = (otherId: string, linked: boolean) =>
    send('set-sight-link', { id: token.id, otherId, linked });

  return (
    <div data-testid="token-sight" className="flex flex-col gap-2 border-t border-border-default pt-2">
      <p className="text-xs uppercase tracking-wide text-text-secondary">Sight &amp; light</p>

      <NullableField
        label="Vision"
        testId="token-sight"
        present={token.sight !== null}
        onAdd={() => update({ sight: DEFAULT_SIGHT })}
        onClear={() => update({ sight: null })}
      >
        <div className="flex items-center gap-1">
          <RangeField
            label="Sight range"
            testId="token-sight-range"
            step={scale.value}
            value={toUnits(token.sight?.range ?? 0, scale)}
            onCommit={(units) => setSight({ range: toCells(units, scale) })}
          />
          <span className={unitLabel}>{scale.unit}</span>
          <select
            aria-label="Vision mode"
            data-testid="token-vision-mode"
            value={token.sight?.visionMode ?? 'normal'}
            onChange={(e) => setSight({ visionMode: e.target.value as Sight['visionMode'] })}
            className="min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-1 py-0.5 text-xs text-text-primary focus:border-border-focus focus:outline-none"
          >
            {VISION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </NullableField>

      <NullableField
        label="Carried light"
        testId="token-light"
        present={token.light !== null}
        onAdd={() => update({ light: DEFAULT_LIGHT })}
        onClear={() => update({ light: null })}
      >
        <div className="flex items-center gap-1">
          <RangeField
            label="Bright light radius"
            testId="token-light-bright"
            step={scale.value}
            value={toUnits(token.light?.bright ?? 0, scale)}
            onCommit={(units) => setLight({ bright: toCells(units, scale) })}
          />
          <span className={unitLabel}>bright</span>
          <RangeField
            label="Dim light radius"
            testId="token-light-dim"
            step={scale.value}
            value={toUnits(token.light?.dim ?? 0, scale)}
            onCommit={(units) => setLight({ dim: toCells(units, scale) })}
          />
          <span className={unitLabel}>dim</span>
          {/* The platform's own colour input: it can only produce `#rrggbb`, which is inside
              the server's `COLOR_MAX` by construction and needs no validation of ours. */}
          <input
            type="color"
            aria-label="Light colour"
            data-testid="token-light-color"
            value={token.light?.color ?? DEFAULT_LIGHT.color}
            onChange={(e) => setLight({ color: e.target.value })}
            className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border-default bg-surface-1"
          />
        </div>
      </NullableField>

      <div className="flex flex-col gap-1 border-t border-border-default pt-2">
        <span className="text-xs text-text-secondary">Shares sight with</span>
        <div data-testid="token-links" className="flex flex-wrap items-center gap-1">
          {links.map((id) => {
            const other = tokens.find((t) => t.id === id);
            return (
              <span
                key={id}
                data-link-id={id}
                className="flex items-center gap-1 rounded-chip border border-border-default bg-surface-2 py-0.5 pl-2 pr-1 text-[11px] text-text-primary"
              >
                {other?.name ?? 'Elsewhere'}
                <button
                  type="button"
                  aria-label={`Unlink ${other?.name ?? id}`}
                  onClick={() => link(id, false)}
                  className="rounded-chip px-0.5 text-text-muted transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus motion-reduce:transition-none"
                >
                  ×
                </button>
              </span>
            );
          })}
          {linkable.length > 0 && (
            // A select rather than a chip that opens a menu: the list is every other token on
            // the scene, it is already a one-of-N choice, and the platform's own picker is
            // keyboard- and screen-reader-complete without a line of ours.
            <select
              aria-label="Link a token"
              data-testid="token-link-add"
              value={linking}
              onChange={(e) => {
                if (e.target.value) link(e.target.value, true);
                setLinking('');
              }}
              className="min-w-0 rounded-chip border border-dashed border-border-default bg-transparent px-1.5 py-0.5 text-[11px] text-text-secondary focus:border-border-focus focus:outline-none"
            >
              <option value="">+ Link token…</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-[11px] text-text-muted">
          Linked tokens see through each other, in every share mode.
        </p>
      </div>
    </div>
  );
}

export function TokenPanel() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players);
  const you = useSessionStore((s) => s.you);
  const selectedId = useTokenInteraction((s) => s.selectedId);
  const select = useTokenInteraction((s) => s.select);

  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again.
  useEffect(() => mountTokenLayerWhenReady(), []);
  useTokenFeedback();

  const mapData = useSessionStore((s) => s.mapData);
  const tokens = useMemo(() => tokensOf(state, sceneId), [state, sceneId]);
  const scale = useMemo(() => mapScale(mapData), [mapData]);
  const selected = tokens.find((t) => t.id === selectedId);
  const owner = players?.find((p) => p.identityId === selected?.ownerId);
  const isDm = you?.role === 'dm';

  return (
    <div className="flex flex-col gap-2 text-sm">
      {tokens.length === 0 ? (
        <p className="text-neutral-500">No tokens on this scene.</p>
      ) : (
        <ul data-testid="token-layer" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {tokens.map((t) => (
            <li
              key={t.id}
              data-token-id={t.id}
              data-x={t.x}
              data-y={t.y}
              data-hidden={t.hidden || undefined}
              data-owner={t.ownerId ?? undefined}
            >
              <button
                type="button"
                aria-current={t.id === selectedId}
                onClick={() => select(t.id)}
                className={`w-full truncate rounded px-2 py-0.5 text-left ${
                  t.id === selectedId
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-400 hover:bg-neutral-800/60'
                }`}
              >
                {t.name}
                {t.hidden && <span className="ml-1 text-xs text-neutral-500">hidden</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div data-testid="token-selection" className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
          <p className="truncate text-neutral-200">{selected.name}</p>
          <p className="text-xs text-neutral-500">
            {selected.size} · {selected.disposition} · {owner ? `held by ${owner.name}` : 'unclaimed'}
          </p>
          <div className="flex flex-wrap gap-1">
            {you?.role === 'player' && selected.ownerId === null && (
              <button
                type="button"
                data-testid="claim-button"
                onClick={() => send('claim', { id: selected.id })}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700"
              >
                Claim
              </button>
            )}
            {isDm && (
              <>
                <button
                  type="button"
                  data-testid="token-hide"
                  onClick={() => send('hide', { id: selected.id, hidden: !selected.hidden })}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700"
                >
                  {selected.hidden ? 'Reveal' : 'Hide'}
                </button>
                <button
                  type="button"
                  data-testid="token-delete"
                  onClick={() => {
                    send('delete', { id: selected.id });
                    select(null);
                  }}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-red-300 hover:bg-neutral-700"
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {isDm && <SightAndLight token={selected} tokens={tokens} scale={scale} send={send} />}
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'tokens', title: 'Tokens', roles: ALL_ROLES, order: 15, component: TokenPanel });
