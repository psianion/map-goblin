// M4 — the player's "how am I" panel: the token(s) this seat owns on the active scene. One
// token is the common case and gets the full card straight away; more than one (a familiar,
// a second PC) collapses to a row each, click to expand. Unclaimed — the seat has not picked
// a token yet — lists what is claimable, same `tokens:claim` command the on-map `TokenMenu`
// and the Tokens popover already send.
//
// HP and conditions are not on the token itself — they live on the initiative entry once an
// encounter puts the token in a fight (`InitiativeEntry.hp`/`.conditions`), same source
// `PartyStrip` reads. Outside a fight there is nothing to show but "—" / "none", which is
// correct: nobody has hit points to speak of until something is trying to change them.

import { useMemo } from 'react';
import { create } from 'zustand';
import { conditionLabel, type InitiativeEntry, type InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint } from '../../renderer/camera';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { Icon } from '../../shell/icons';
import { usePortraitUrl } from '../../shell/portrait';
import { mapScale, toUnits, VISION_MODES, type Light, type MapScale, type Sight } from './sight';
import { initials, tokensOf, useClaimedTokens } from './TokenRenderer';
import { buttonClass, ghostButtonClass, quietButtonClass } from './tokensUi';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

function sightLabel(sight: Sight | null, scale: MapScale): string {
  if (!sight) return 'nothing special';
  const mode = VISION_MODES.find((m) => m.value === sight.visionMode)?.label ?? sight.visionMode;
  return `${toUnits(sight.range, scale)} ${scale.unit} · ${mode.toLowerCase()}`;
}

function lightLabel(light: Light | null, scale: MapScale): string {
  if (!light) return 'no light';
  return `torch · ${toUnits(light.bright, scale)} / ${toUnits(light.dim, scale)} ${scale.unit}`;
}

const entryFor = (entries: InitiativeEntry[] | undefined, tokenId: string): InitiativeEntry | undefined =>
  entries?.find((e) => e.tokenId === tokenId);

/** `{current: 0, max: 0}` is the wire's redacted/unset shape (same one `PartyStrip` reads as
 *  an NPC's hidden pool) — for a player reading their OWN claimed token that means "nothing
 *  set", not "at zero", so it reads as "—" here rather than as downed (M3 review finding 10;
 *  `PartyStrip` keeps its own `{0,0}` → down rule, that redaction signal is real for an NPC). */
const realHp = (hp: { current: number; max: number } | undefined): { current: number; max: number } | null =>
  hp && !(hp.current === 0 && hp.max === 0) ? hp : null;

/** Which claimed token the footer's "Find me" targets, and which row's detail is open — a
 *  sibling to the panel body (`PanelDef.footer`, see `Popover.tsx`), so this is a store like
 *  `tokensUi.ts`'s rather than component state either one owns alone. */
const useMeUi = create<{ expandedId: string | null; setExpanded: (id: string | null) => void }>()((set) => ({
  expandedId: null,
  setExpanded: (expandedId) => set({ expandedId }),
}));

function Portrait({ token, size }: { token: Token; size: number }) {
  const portrait = usePortraitUrl(token.imageAssetId);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 border border-border-structure"
      style={{ width: size, height: size }}
    >
      {portrait ? (
        <img src={portrait} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-mono text-text-secondary" style={{ fontSize: size * 0.34 }}>
          {initials(token.name)}
        </span>
      )}
    </span>
  );
}

function TokenDetail({
  token,
  scale,
  entries,
}: {
  token: Token;
  scale: MapScale;
  entries: InitiativeEntry[] | undefined;
}) {
  const entry = entryFor(entries, token.id);
  const hp = realHp(entry?.hp);
  const conditions = entry?.conditions ?? [];
  const barPct = hp && hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Portrait token={token} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[15px] text-text-primary">
              {hp ? `${hp.current} / ${hp.max}` : '—'}
            </span>
            <span className="ml-auto shrink-0 text-xs text-text-muted">
              {capitalize(token.size)} · {token.disposition}
            </span>
          </div>
          {barPct !== null && (
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3">
              <span
                className={`block h-full rounded-full ${barPct <= 25 ? 'bg-danger' : 'bg-text-secondary'}`}
                style={{ width: `${barPct}%` }}
              />
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-[72px] shrink-0 text-text-secondary">Conditions</span>
        {conditions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {conditions.map((c) => (
              <span
                key={c}
                className="rounded border border-border-default px-1 text-[9px] uppercase tracking-[.06em] text-text-secondary"
              >
                {conditionLabel(c)}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-text-muted">none</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-[72px] shrink-0 text-text-secondary">You see</span>
        <span className="text-text-primary">{sightLabel(token.sight, scale)}</span>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-[72px] shrink-0 text-text-secondary">Carrying</span>
        <span className="text-text-primary">{lightLabel(token.light, scale)}</span>
      </div>

      {/* Beyond20 link (avatar is stored, never shown here — name/url only). */}
      {token.sheet && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-[72px] shrink-0 text-text-secondary">Sheet</span>
          <span className="min-w-0 flex-1 truncate text-text-primary">{token.sheet.name}</span>
          {token.sheet.url && (
            <a
              href={token.sheet.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-accent-active hover:underline"
            >
              Open sheet
            </a>
          )}
          <button
            type="button"
            data-testid={`sheet-unlink-${token.id}`}
            onClick={() => send('update', { id: token.id, sheet: null })}
            className={quietButtonClass}
          >
            Unlink
          </button>
        </div>
      )}
    </div>
  );
}

function CompactRow({
  token,
  entries,
  expanded,
  onToggle,
}: {
  token: Token;
  entries: InitiativeEntry[] | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hp = realHp(entryFor(entries, token.id)?.hp);
  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-testid={`me-row-${token.id}`}
      onClick={onToggle}
      className={`flex h-8 items-center gap-2 rounded px-1.5 text-left text-sm transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
        expanded ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <Portrait token={token} size={28} />
      <span className="min-w-0 flex-1 truncate text-text-primary">{token.name}</span>
      <span className="shrink-0 font-mono text-xs text-text-secondary">
        {hp ? `${hp.current}/${hp.max}` : '—'}
      </span>
    </button>
  );
}

function ClaimableRow({ token, first }: { token: Token; first: boolean }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded px-1.5 text-sm">
      <Portrait token={token} size={28} />
      <span className="min-w-0 flex-1 truncate text-text-primary">{token.name}</span>
      <button
        type="button"
        data-testid={first ? 'claim-button' : undefined}
        onClick={() => send('claim', { id: token.id })}
        className={buttonClass}
      >
        Claim
      </button>
    </div>
  );
}

export function MePanel() {
  const tokensState = useModuleState<TokensState>('tokens');
  const initiativeState = useModuleState<InitiativeState>('initiative');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const scale = useMemo(() => mapScale(mapData), [mapData]);
  const expandedId = useMeUi((s) => s.expandedId);
  const setExpanded = useMeUi((s) => s.setExpanded);

  const allTokens = useMemo(() => tokensOf(tokensState, sceneId), [tokensState, sceneId]);
  const claimed = useClaimedTokens();
  const entries = initiativeState && initiativeState.status !== 'idle' ? initiativeState.entries : undefined;

  if (claimed.length === 0) {
    const claimable = allTokens.filter((t) => t.ownerId === null && !t.hidden);
    return (
      <div data-testid="me-panel" className="flex min-h-0 flex-1 flex-col gap-0.5">
        {claimable.length === 0 ? (
          <p className="text-sm text-text-muted">No claimable tokens on this scene.</p>
        ) : (
          claimable.map((t, i) => <ClaimableRow key={t.id} token={t} first={i === 0} />)
        )}
      </div>
    );
  }

  if (claimed.length === 1) {
    return (
      <div data-testid="me-panel" className="flex min-h-0 flex-1 flex-col gap-2">
        <TokenDetail token={claimed[0]} scale={scale} entries={entries} />
      </div>
    );
  }

  return (
    <div data-testid="me-panel" className="flex min-h-0 flex-1 flex-col gap-0.5">
      {claimed.map((t) => (
        <div key={t.id} className="flex flex-col">
          <CompactRow
            token={t}
            entries={entries}
            expanded={expandedId === t.id}
            onToggle={() => setExpanded(expandedId === t.id ? null : t.id)}
          />
          {expandedId === t.id && (
            <div className="px-1.5 pb-1.5 pt-1">
              <TokenDetail token={t} scale={scale} entries={entries} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MeFooter() {
  const claimed = useClaimedTokens();
  const expandedId = useMeUi((s) => s.expandedId);
  const target = claimed.length === 1 ? claimed[0] : (claimed.find((t) => t.id === expandedId) ?? claimed[0]);

  return (
    <>
      {target && (
        <button
          type="button"
          onClick={() => frameWorldPoint(target.x, target.y)}
          className={`${ghostButtonClass} flex items-center gap-1.5`}
        >
          <Icon name="frame" size={13} />
          Find me
        </button>
      )}
      <span className="flex-1" />
      <span className="text-[11px] text-text-muted">HP and conditions are set by the DM</span>
    </>
  );
}

/** The rail label is always "Me" (M3 review finding 4 — a long character name used to wrap
 *  past the rail item's 46px and shift every anchor below it); the claimed token's own name
 *  shows as the popover's subtitle instead, same slot `sceneSubtitle`/`worldSubtitle` use. */
function meSubtitle(): string | null {
  const { session, you } = useSessionStore.getState();
  const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, session?.activeSceneId).filter(
    (t) => t.ownerId === you?.identityId,
  );
  return tokens.length === 1 ? tokens[0].name : null;
}

registerPanel({
  id: 'me',
  title: 'Me',
  icon: 'me',
  key: 'M',
  group: 'play',
  roles: ['player'],
  order: 45,
  component: MePanel,
  footer: MeFooter,
  subtitle: meSubtitle,
});
