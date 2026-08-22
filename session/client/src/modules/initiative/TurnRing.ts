// The turn ring — one Pixi Graphics in the world container marking the token whose turn the
// initiative order says it is. Both seats draw it: the player who is up should find their own
// token on the map without reading a panel, and the DM should see the same mark the table sees.
//
// It is not part of TokenRenderer's per-token view because it belongs to a different module's
// state: at most one ring exists at a time, and rebuilding a token sprite every time the turn
// advances would throw away its portrait texture and its in-flight drag.

import { Graphics, type Ticker } from 'pixi.js';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { SIZE_CELLS, type Token, type TokensState } from '@dnd/mechanics/tokens';
import {
  LINE_INK,
  LINE_WHITE,
  OVERLAY_INK,
  OVERLAY_INK_ALPHA,
  OVERLAY_WHITE,
} from '@dnd/core/src/engine/overlayPalette';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { addWorldOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { tokensOf } from '../tokens/TokenRenderer';

/** Pixels per world unit at 100% zoom, i.e. what the constants below were authored against. */
const REFERENCE_ZOOM = 20;

// Palette line weights are CSS px; one world unit is REFERENCE_ZOOM of them at 100%.
const WHITE_WIDTH = LINE_WHITE / REFERENCE_ZOOM;
const INK_WIDTH = LINE_INK / REFERENCE_ZOOM;
/** Clearance between the token's own footprint and the ring, world units at 100%. */
const OUTSET = 0.2;

/** Broken into arcs so it never reads as one more disposition ring around the token. */
const SEGMENTS = 4;
/** Fraction of the circle left open at each segment join. */
const SEGMENT_GAP = 0.08;
const TAU = Math.PI * 2;

/** One slow turn every 14s: enough to catch a glance, not enough to hold one. */
const RAD_PER_MS = TAU / 14_000;

export interface RingGeometry {
  radius: number;
  whiteWidth: number;
  inkWidth: number;
}

/**
 * `zoom` is `stage().scale.x` — pixels per world unit, 20 at 100% — so dividing each authored
 * world constant by `zoom / REFERENCE_ZOOM` cancels the world container's own scale exactly and
 * pins the ring to a fixed on-screen weight however far the camera pulls back. The token's
 * radius is deliberately *not* divided: that footprint really does grow with the map, and a ring
 * that stopped tracking it would drift into the art.
 */
export function ringGeometry(sizeCells: number, zoom: number): RingGeometry {
  const scale = (zoom || REFERENCE_ZOOM) / REFERENCE_ZOOM;
  return {
    radius: sizeCells / 2 + OUTSET / scale,
    whiteWidth: WHITE_WIDTH / scale,
    inkWidth: INK_WIDTH / scale,
  };
}

/**
 * The token to ring, or null for the many states that draw nothing: no encounter running, the
 * table looking at another scene, an off-board combatant, or a token that has left the board.
 *
 * `entries` *is* the turn order once running (see the mechanics types), so this indexes it
 * rather than re-sorting — a client that sorted for itself could disagree with the server about
 * whose turn it is, which is the one thing this overlay must never do.
 */
export function activeTurnToken(
  state: InitiativeState | undefined,
  tokens: TokensState | undefined,
  activeSceneId: string | null | undefined,
): Token | null {
  if (state?.status !== 'running') return null;
  // The encounter belongs to the scene it started on, so the ring stays behind when the DM
  // walks the table elsewhere — same rule the panel uses to hide itself.
  if (!activeSceneId || state.sceneId !== activeSceneId) return null;
  const entry = state.entries?.[state.turn];
  if (!entry?.tokenId) return null;
  return tokensOf(tokens, activeSceneId).find((t) => t.id === entry.tokenId) ?? null;
}

function ringPath(g: Graphics, radius: number): void {
  for (let i = 0; i < SEGMENTS; i++) {
    const from = (i / SEGMENTS + SEGMENT_GAP / 2) * TAU;
    const to = ((i + 1) / SEGMENTS - SEGMENT_GAP / 2) * TAU;
    // Each arc opens its own subpath; without the moveTo Pixi joins it to the previous arc's
    // end and the gaps fill in with chords.
    g.moveTo(Math.cos(from) * radius, Math.sin(from) * radius);
    g.arc(0, 0, radius, from, to);
  }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function mountTurnRing(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const world = sceneGraph.worldContainer;
  const g = new Graphics();
  addWorldOverlay(sceneGraph, g, 'turnRing');

  const still = prefersReducedMotion();
  let target: Token | null = null;
  let lastSig = '';
  let lastZoom = NaN;
  let dirty = true;

  /** The live sprite, so the ring rides an in-flight drag instead of the last synced x/y. */
  const spritePosition = (token: Token): { x: number; y: number } =>
    world.getChildByLabel('tokenLayer')?.getChildByLabel(`token-${token.id}`) ?? token;

  const sync = () => {
    const { session } = useSessionStore.getState();
    target = activeTurnToken(
      session?.modules?.initiative as InitiativeState | undefined,
      session?.modules?.tokens as TokensState | undefined,
      session?.activeSceneId,
    );
    // Position is followed per frame; only size and identity change what is drawn, and the store
    // fires on every ping, so the signature is what keeps this off the redraw path.
    const sig = target ? `${target.id}|${target.size}` : '';
    if (sig === lastSig) return;
    lastSig = sig;
    dirty = true;
  };

  const redraw = (zoom: number) => {
    g.clear();
    g.visible = !!target;
    if (!target) return;
    const { radius, whiteWidth, inkWidth } = ringGeometry(SIZE_CELLS[target.size] ?? 1, zoom);
    ringPath(g, radius);
    g.stroke({ color: OVERLAY_INK, width: inkWidth, alpha: OVERLAY_INK_ALPHA });
    ringPath(g, radius);
    g.stroke({ color: OVERLAY_WHITE, width: whiteWidth, alpha: 0.95 });
  };

  const tick = (ticker: Ticker) => {
    // Zoom is plain Pixi stage state with nothing in the store to subscribe to, so a per-frame
    // poll against the last-seen value is what notices the camera moved.
    const zoom = engine.stage().scale.x;
    if (dirty || zoom !== lastZoom) {
      dirty = false;
      lastZoom = zoom;
      redraw(zoom);
    }
    if (!target) return;
    const at = spritePosition(target);
    g.position.set(at.x, at.y);
    // Spinning the container instead of redrawing the arcs keeps the idle animation off the
    // geometry path entirely.
    if (!still) g.rotation = (g.rotation + ticker.deltaMS * RAD_PER_MS) % TAU;
  };

  const unsubscribe = useSessionStore.subscribe(sync);
  const ticker = engine.ticker();
  ticker.add(tick);
  sync();

  return () => {
    unsubscribe();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are destroyed
    // and touching them throws.
    try {
      ticker.remove(tick);
      if (!g.destroyed) g.destroy();
    } catch {
      /* engine torn down first */
    }
  };
}

/**
 * The engine is booted asynchronously by GameRenderer and cleared when it unmounts, so this
 * waits for one rather than assuming it. Call from an effect; the returned function is the
 * effect's cleanup.
 */
export const mountTurnRingWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountTurnRing, pollMs);
