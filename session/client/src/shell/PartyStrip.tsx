// M1 — top-left is the party, not the scene name (plan §"Top-left is the party"). Out of
// combat: the claimed and friendly tokens on the active scene. In an encounter: the turn
// order, current turn ringed, round chip at the end. Click a disc to frame its token.

import { ordered, type InitiativeEntry, type InitiativeState } from '@dnd/mechanics/initiative';
import type { Disposition, Token, TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint } from '../renderer/camera';
import { useModuleState, useSessionStore } from '../session/store';
import { usePortraitUrl } from './portrait';

const DISPOSITION_RING: Record<Disposition, string> = {
  friendly: 'ring-info',
  hostile: 'ring-danger',
  neutral: 'ring-border-structure',
};

/** "Willow Ashgrove" -> "WA"; one word -> its first letter. */
const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** A redacted NPC arrives as `{0, 0}` (initiative/module.ts) — `current === 0` covers both
 *  that and a real pool run dry. */
const isDown = (hp: { current: number; max: number } | undefined): boolean =>
  !!hp && hp.current === 0;

interface DiscData {
  discKey: string;
  name: string;
  imageAssetId: string | null;
  disposition: Disposition | null;
  current: boolean;
  down: boolean;
  /** null = off-board (no token to frame); the disc renders inert, not as a button. */
  worldXY: { x: number; y: number } | null;
  /** Literal text over the computed initials — only the "+N" overflow chip uses this. */
  text?: string;
}

function PartyDisc({ d }: { d: DiscData }) {
  const portrait = usePortraitUrl(d.imageAssetId);
  const ring = d.current
    ? 'ring-2 ring-accent-active shadow-[0_0_6px_rgb(var(--accent-active)/0.55)]'
    : d.disposition
      ? `ring-[1.5px] ${DISPOSITION_RING[d.disposition]}`
      : '';

  const face = (
    <span
      className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 ${ring} ${d.down ? 'opacity-50' : ''}`}
    >
      {portrait ? (
        <img src={portrait} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-mono text-[11px] text-text-secondary">{d.text ?? initials(d.name)}</span>
      )}
      {d.down && <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-text-primary" />}
    </span>
  );

  if (!d.worldXY) {
    return (
      <div data-testid={`party-disc-${d.discKey}`} data-current={d.current || undefined} title={d.name}>
        {face}
      </div>
    );
  }

  const { x, y } = d.worldXY;
  return (
    <button
      type="button"
      data-testid={`party-disc-${d.discKey}`}
      data-current={d.current || undefined}
      aria-label={d.name}
      title={d.name}
      onClick={() => frameWorldPoint(x + 0.5, y + 0.5)}
      className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      {face}
    </button>
  );
}

export function PartyStrip() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const initiative = useModuleState<InitiativeState>('initiative');
  const tokens = useModuleState<TokensState>('tokens');
  const byId = (sceneId ? tokens?.byScene?.[sceneId] : undefined) ?? {};

  const encounter = !!initiative && initiative.status !== 'idle' && initiative.sceneId === sceneId;

  let discs: DiscData[];
  let round: number | null = null;

  if (encounter && initiative) {
    round = initiative.round;
    const running = initiative.status === 'running';
    const order = running ? initiative.entries : ordered(initiative.entries);
    discs = order.map((e: InitiativeEntry, i: number) => {
      const token = e.tokenId ? byId[e.tokenId] : undefined;
      return {
        discKey: e.key,
        name: e.name,
        imageAssetId: token?.imageAssetId ?? null,
        disposition: token?.disposition ?? null,
        current: running && i === initiative.turn,
        down: isDown(e.hp),
        worldXY: token ? { x: token.x, y: token.y } : null,
      };
    });
  } else {
    const list = Object.values(byId) as Token[];
    const claimed = list.filter((t) => t.ownerId !== null);
    const friendly = list.filter((t) => t.ownerId === null && t.disposition === 'friendly');
    const party = [...claimed, ...friendly];
    discs = party.slice(0, 8).map((t) => ({
      discKey: t.id,
      name: t.name,
      imageAssetId: t.imageAssetId,
      disposition: t.disposition,
      current: false,
      down: false,
      worldXY: { x: t.x, y: t.y },
    }));
    if (party.length > 8) {
      const n = party.length - 8;
      discs.push({
        discKey: 'overflow',
        name: `${n} more`,
        imageAssetId: null,
        disposition: null,
        current: false,
        down: false,
        worldXY: null,
        text: `+${n}`,
      });
    }
  }

  if (discs.length === 0) return null;

  return (
    <div
      data-testid="party-strip"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-2.5 top-2.5 flex h-[38px] items-center gap-1.5 rounded-full border border-border-structure bg-surface-1/92 px-2 shadow-[var(--panel-shadow)]"
    >
      {discs.map((d) => (
        <PartyDisc key={d.discKey} d={d} />
      ))}
      {round !== null && (
        <span className="rounded-full bg-surface-3 px-1.5 font-mono text-[11px] text-text-dim">
          R{round}
        </span>
      )}
    </div>
  );
}
