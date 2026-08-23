// §2.4.8 — the shared token panel: what is on this scene, what you have selected, and
// the claim affordance. It is also where the Pixi overlay is mounted from, because a
// panel is this module's only React lifecycle (D8) and the engine is only ready some time
// after boot (§4).
//
// M3: two tabs — On map (this file) and Library (TokenLibraryPanel.tsx) — behind one
// popover, with one footer that switches on the active tab. Tab state is UI-only and lives
// in `useTokensUi` (tokensUi.ts), a module-level store rather than component state, because
// the footer is a sibling `PanelDef.footer` component (see `Popover.tsx`), not a child, and
// needs to read the same tab.

import { useEffect, useMemo, useState } from 'react';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint } from '../../renderer/camera';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { showToast } from '../../session/toasts';
import { Icon } from '../../shell/icons';
import { liveSceneDoors } from '../doors/DoorRenderer';
import { tokenRefusal, useTokenInteraction } from './drag';
import { useSightPreview } from './sightPreview';
import {
  DEFAULT_LIGHT,
  DEFAULT_SIGHT,
  VISION_MODES,
  mapScale,
  toCells,
  toUnits,
  type MapScale,
  type Sight,
} from './sight';
import { TokenLibraryPanel } from './TokenLibraryPanel';
import { mountTokenLayerWhenReady, tokensOf } from './TokenRenderer';
import {
  DOT_CLASS,
  MAP_DETAIL_COLLAPSE_AT,
  MAP_FILTER_AT,
  MAP_ROW_CAP,
  armedButtonClass,
  buttonClass,
  filterInputClass,
  ghostButtonClass,
  ghostDangerButtonClass,
  numberFieldClass,
  quietButtonClass,
  selectFieldClass,
  useTokenLibraryUi,
  useTokensUi,
} from './tokensUi';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

/**
 * Turns the server's refusal into the one toast the table has — the doors lane's
 * `useDoorFeedback`, for the move a player is not allowed to make. Without it the only
 * feedback is the 600ms rubber-band in `TokenRenderer`, which reads as a dropped frame
 * rather than as an answer.
 */
function useTokenFeedback(): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    const message = tokenRefusal(lastError.message, liveSceneDoors());
    if (!message) return;
    showToast({ message });
  }, [lastError]);
}

// ── P4 §3/§4 — Sight & light, and who this token shares it with ────────────
// DM-only, and that is enforced on the server rather than by hiding the controls: `sight`
// and `light` are in `UPDATE_FIELDS`, which a non-DM may not touch even on a token they own.

const unitLabel = 'shrink-0 text-[11px] text-text-muted';

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
      className={numberFieldClass}
    />
  );
}

function VisionRow({ token, scale }: { token: Token; scale: MapScale }) {
  const sight = token.sight;
  const setSight = (patch: Partial<Sight>) =>
    send('update', { id: token.id, sight: { ...(sight ?? DEFAULT_SIGHT), ...patch } });
  return (
    <div data-testid="token-sight" className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-xs text-text-secondary">Vision</span>
      {sight ? (
        <>
          <RangeField
            label="Sight range"
            testId="token-sight-range"
            step={scale.value}
            value={toUnits(sight.range, scale)}
            onCommit={(units) => setSight({ range: toCells(units, scale) })}
          />
          <span className={unitLabel}>{scale.unit}</span>
          <select
            aria-label="Vision mode"
            data-testid="token-vision-mode"
            value={sight.visionMode}
            onChange={(e) => setSight({ visionMode: e.target.value as Sight['visionMode'] })}
            className={selectFieldClass}
          >
            {VISION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="token-sight-clear"
            onClick={() => send('update', { id: token.id, sight: null })}
            className={quietButtonClass}
          >
            None
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-xs text-text-muted">Off</span>
          <button
            type="button"
            data-testid="token-sight-add"
            onClick={() => send('update', { id: token.id, sight: DEFAULT_SIGHT })}
            className={quietButtonClass}
          >
            Add
          </button>
        </>
      )}
    </div>
  );
}

/** The token-linking chips, tucked behind Light row's "Link sight" toggle (M3 — the ledger
 *  has no room to keep this open by default once a scene has more than a couple of tokens). */
function LinkPicker({ token, tokens }: { token: Token; tokens: readonly Token[] }) {
  const [linking, setLinking] = useState('');
  const links = token.sharesSightWith ?? [];
  const linkable = tokens.filter((t) => t.id !== token.id && !links.includes(t.id));
  const link = (otherId: string, linked: boolean) => send('set-sight-link', { id: token.id, otherId, linked });

  return (
    <div data-testid="token-links" className="flex flex-wrap items-center gap-1 pl-[62px]">
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
              className="rounded-chip px-0.5 text-text-muted transition-colors duration-150 ease-settle hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus motion-reduce:transition-none"
            >
              ×
            </button>
          </span>
        );
      })}
      {linkable.length > 0 && (
        <select
          aria-label="Link a token"
          data-testid="token-link-add"
          value={linking}
          onChange={(e) => {
            if (e.target.value) link(e.target.value, true);
            setLinking('');
          }}
          className="min-w-0 rounded-chip border border-dashed border-border-default bg-transparent px-1.5 py-0.5 text-[11px] text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
  );
}

function LightRow({ token, scale, tokens }: { token: Token; scale: MapScale; tokens: readonly Token[] }) {
  const light = token.light;
  const [linksOpen, setLinksOpen] = useState((token.sharesSightWith ?? []).length > 0);
  const setLight = (patch: Partial<typeof DEFAULT_LIGHT>) =>
    send('update', { id: token.id, light: { ...(light ?? DEFAULT_LIGHT), ...patch } });
  const linkCount = (token.sharesSightWith ?? []).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 shrink-0 text-xs text-text-secondary">Light</span>
        {light ? (
          <>
            <RangeField
              label="Bright light radius"
              testId="token-light-bright"
              step={scale.value}
              value={toUnits(light.bright, scale)}
              onCommit={(units) => setLight({ bright: toCells(units, scale) })}
            />
            <RangeField
              label="Dim light radius"
              testId="token-light-dim"
              step={scale.value}
              value={toUnits(light.dim, scale)}
              onCommit={(units) => setLight({ dim: toCells(units, scale) })}
            />
            {/* The platform's own colour input: it can only produce `#rrggbb`, which is
                inside the server's `COLOR_MAX` by construction and needs no validation of
                ours. */}
            <input
              type="color"
              aria-label="Light colour"
              data-testid="token-light-color"
              value={light.color}
              onChange={(e) => setLight({ color: e.target.value })}
              className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border-default bg-surface-1"
            />
            <button
              type="button"
              aria-label="Clear carried light"
              data-testid="token-light-clear"
              onClick={() => send('update', { id: token.id, light: null })}
              className={quietButtonClass}
            >
              ×
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-text-muted">carries none</span>
            <button
              type="button"
              data-testid="token-light-add"
              onClick={() => send('update', { id: token.id, light: DEFAULT_LIGHT })}
              className={quietButtonClass}
            >
              Add
            </button>
          </>
        )}
        <button
          type="button"
          aria-expanded={linksOpen}
          data-testid="token-link-toggle"
          onClick={() => setLinksOpen((v) => !v)}
          className={`${quietButtonClass} ml-auto`}
        >
          Link sight{linkCount > 0 ? ` · ${linkCount}` : ''}
        </button>
      </div>
      {linksOpen && <LinkPicker token={token} tokens={tokens} />}
    </div>
  );
}

function OnMapTab() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players);
  const you = useSessionStore((s) => s.you);
  const selectedId = useTokenInteraction((s) => s.selectedId);
  const select = useTokenInteraction((s) => s.select);
  const mapData = useSessionStore((s) => s.mapData);
  const filter = useTokensUi((s) => s.mapFilter);
  const setFilter = useTokensUi((s) => s.setMapFilter);
  const detailExpanded = useTokensUi((s) => s.detailExpanded);
  const setDetailExpanded = useTokensUi((s) => s.setDetailExpanded);

  const tokens = useMemo(() => tokensOf(state, sceneId), [state, sceneId]);
  const scale = useMemo(() => mapScale(mapData), [mapData]);
  const isDm = you?.role === 'dm';

  // A freshly selected row always starts collapsed past the threshold — the DM opts back
  // into the full block per row rather than it staying open across a different selection.
  useEffect(() => {
    setDetailExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const showFilter = tokens.length >= MAP_FILTER_AT;
  const needle = filter.trim().toLowerCase();
  const filtered = needle ? tokens.filter((t) => t.name.toLowerCase().includes(needle)) : tokens;
  const shown = filtered.slice(0, MAP_ROW_CAP);
  const hiddenCount = filtered.length - shown.length;

  const selected = tokens.find((t) => t.id === selectedId);
  const owner = players?.find((p) => p.identityId === selected?.ownerId);
  const collapseDetail = isDm && tokens.length >= MAP_DETAIL_COLLAPSE_AT && !detailExpanded;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
      {showFilter && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tokens"
          aria-label="Filter tokens"
          data-testid="token-filter"
          className={filterInputClass}
        />
      )}

      {tokens.length === 0 ? (
        <p className="text-text-muted">No tokens on this scene.</p>
      ) : (
        <>
          <ul data-testid="token-layer" className="flex flex-col">
            {shown.map((t) => (
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
                  className={`flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
                    t.id === selectedId ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:bg-surface-2/60'
                  }`}
                >
                  <i className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[t.disposition] ?? DOT_CLASS.neutral}`} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {isDm && t.hidden ? (
                    <span className="flex shrink-0 items-center gap-1 text-text-muted">
                      <Icon name="hide" size={13} />
                      <span className="text-[11px]">hidden</span>
                    </span>
                  ) : t.ownerId ? (
                    <span className="shrink-0 truncate rounded border border-border-default px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                      {players?.find((p) => p.identityId === t.ownerId)?.name ?? ''}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && <p className="text-[11px] text-text-muted">+{hiddenCount} more</p>}
        </>
      )}

      {selected && (
        <div data-testid="token-selection" className="flex flex-col gap-2 border-t border-border-default pt-2">
          {collapseDetail ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-text-secondary">
                {selected.name} · {selected.size} · {selected.disposition}
              </span>
              <button
                type="button"
                data-testid="token-detail-toggle"
                onClick={() => setDetailExpanded(true)}
                className={quietButtonClass}
              >
                Details
              </button>
            </div>
          ) : isDm ? (
            <>
              {tokens.length >= MAP_DETAIL_COLLAPSE_AT && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="token-detail-toggle"
                    onClick={() => setDetailExpanded(false)}
                    className={quietButtonClass}
                  >
                    Less
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 text-xs text-text-secondary">Owner</span>
                {/* Claiming is also done by clicking a token on your own list, and in vision
                    mode a seat with no token is sent no tokens at all — so a player who joins
                    late can never claim their way in. The DM hands one over from here instead;
                    "Unassigned" takes it back. */}
                <select
                  aria-label="Owner"
                  data-testid="token-owner"
                  value={selected.ownerId ?? ''}
                  onChange={(e) => send('assign', { id: selected.id, identityId: e.target.value || null })}
                  className={selectFieldClass}
                >
                  <option value="">Unassigned</option>
                  {players
                    ?.filter((p) => p.role === 'player')
                    .map((p) => (
                      <option key={p.identityId} value={p.identityId}>
                        {p.name}
                      </option>
                    ))}
                  {/* An owner who is not at the table — a seat from an earlier session. Listed
                      so the select says what the token actually is, and so "Unassigned" is a
                      change the DM can make; with the value missing, the control read
                      "Unassigned" while the token stayed somebody's. */}
                  {selected.ownerId && !players?.some((p) => p.identityId === selected.ownerId) && (
                    <option value={selected.ownerId}>Someone who left</option>
                  )}
                </select>
                <button
                  type="button"
                  data-testid="token-hide"
                  onClick={() => send('hide', { id: selected.id, hidden: !selected.hidden })}
                  className={buttonClass}
                >
                  {selected.hidden ? 'Reveal' : 'Hide'}
                </button>
              </div>
              <VisionRow token={selected} scale={scale} />
              <LightRow token={selected} scale={scale} tokens={tokens} />
            </>
          ) : selected.ownerId === null ? (
            <button
              type="button"
              data-testid="claim-button"
              onClick={() => send('claim', { id: selected.id })}
              className={buttonClass}
            >
              Claim {selected.name}
            </button>
          ) : (
            <p className="text-xs text-text-muted">
              {selected.name} · claimed by {owner?.name ?? 'another player'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TokenPanel() {
  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again. Runs regardless of which tab is active.
  useTokenFeedback();

  const tab = useTokensUi((s) => s.tab);
  const setTab = useTokensUi((s) => s.setTab);
  const you = useSessionStore((s) => s.you);
  const isDm = you?.role === 'dm';
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const onMapCount = useMemo(() => tokensOf(state, sceneId).length, [state, sceneId]);
  const libraryCount = state?.library && typeof state.library === 'object' ? Object.keys(state.library).length : 0;

  return (
    <>
      <div className="-mx-3 flex gap-3.5 border-b border-border-default px-3.5">
        <button
          type="button"
          data-testid="tokens-tab-onmap"
          onClick={() => setTab('map')}
          className={`-mb-px border-b py-2 text-xs transition-colors duration-150 ease-settle ${
            tab === 'map' ? 'border-text-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          On map · {onMapCount}
        </button>
        {isDm && (
          <button
            type="button"
            data-testid="tokens-tab-library"
            onClick={() => setTab('library')}
            className={`-mb-px border-b py-2 text-xs transition-colors duration-150 ease-settle ${
              tab === 'library' ? 'border-text-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            Library · {libraryCount}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
        {tab === 'library' && isDm ? <TokenLibraryPanel /> : <OnMapTab />}
      </div>
    </>
  );
}

function MapFooter({ isDm }: { isDm: boolean }) {
  const selectedId = useTokenInteraction((s) => s.selectedId);
  const select = useTokenInteraction((s) => s.select);
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const tokens = useMemo(() => tokensOf(state, sceneId), [state, sceneId]);
  const selected = tokens.find((t) => t.id === selectedId);
  const preview = useSightPreview(selected);
  if (!selected) return null;

  return (
    <>
      {isDm && (
        <button
          type="button"
          data-testid="token-delete"
          onClick={() => {
            send('delete', { id: selected.id });
            select(null);
          }}
          className={ghostDangerButtonClass}
        >
          Delete
        </button>
      )}
      <span className="flex-1" />
      {isDm && (
        // The DM's own canvas through this token's eyes — the players' seats are untouched.
        <button
          type="button"
          data-testid="token-preview-sight"
          aria-pressed={preview.on}
          disabled={preview.reason !== null}
          title={preview.reason ?? (preview.on ? 'Stop drawing this token’s sight on your map' : 'Draw what this token can see on your map')}
          onClick={preview.toggle}
          className={`${preview.on && preview.reason === null ? armedButtonClass : ghostButtonClass} flex items-center gap-1.5`}
        >
          <Icon name="reveal" size={15} />
          {preview.on ? 'Showing sight' : 'Show sight'}
        </button>
      )}
      <button
        type="button"
        data-testid="token-frame"
        onClick={() => frameWorldPoint(selected.x, selected.y)}
        className={ghostButtonClass}
      >
        Frame
      </button>
    </>
  );
}

function LibraryFooter() {
  const openNew = useTokenLibraryUi((s) => s.openNew);
  return (
    <>
      <button type="button" data-testid="token-new" onClick={openNew} className={`${buttonClass} flex items-center gap-1.5`}>
        <Icon name="plus" size={13} />
        New token
      </button>
      <span className="flex-1" />
      <span className="text-[11px] text-text-muted">Portraits: png, jpg, webp</span>
    </>
  );
}

function TokenPanelFooter() {
  const tab = useTokensUi((s) => s.tab);
  const you = useSessionStore((s) => s.you);
  const isDm = you?.role === 'dm';
  if (tab === 'library' && isDm) return <LibraryFooter />;
  return <MapFooter isDm={isDm} />;
}

registerPanel({
  id: 'tokens',
  title: 'Tokens',
  icon: 'tokens',
  key: 'T',
  group: 'play',
  roles: ALL_ROLES,
  // M4 — the player's fast path is the on-map TokenMenu (Claim); the rail stays DM-only
  // clutter otherwise (a player still opens this with the T key).
  railRoles: ['dm'],
  order: 40,
  component: TokenPanel,
  mount: mountTokenLayerWhenReady,
  footer: TokenPanelFooter,
});
