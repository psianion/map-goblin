// Overhead props at the table: a canopy, a web or a bridge fades for a token standing under
// it, so the token stays readable.
//
// Since the Lighting pass the overhead art takes the lighting like everything else, at the
// table too: core's `overheadContainer` stays in the world container, under the lighting
// multiply (night darkens a canopy like the floor under it), where it used to be lifted into
// a screen overlay above it. Tokens stay above the multiply — they are UI, not scenery. What
// is left here is the fade: core keeps adding and syncing sprites in the same container
// throughout, so nothing rebuilds a sprite; the fade goes through `setOverheadFade`.

import { Container, type Ticker } from 'pixi.js';
import type { TokensState } from '@dnd/mechanics/tokens';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { overheadEntries, setOverheadFade } from '@dnd/core/src/engine/subscribeToAssets';
import type { Obb } from '@dnd/core/src/engine/tools/propPlacement';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { approach } from './drag';
import { tokensOf } from './TokenRenderer';

/** How far an overhead prop fades while a token the viewer can see stands under it. */
export const OVERHEAD_FADE = 0.25;

/** The fade's ease, `approach`'s ~95% time. */
const FADE_MS = 150;

/** Whether a point lies inside an oriented box (edges included). */
export function obbContains(obb: Obb, x: number, y: number): boolean {
  const dx = x - obb.cx;
  const dy = y - obb.cy;
  const c = Math.cos(obb.rot);
  const s = Math.sin(obb.rot);
  return Math.abs(dx * c + dy * s) <= obb.hw && Math.abs(-dx * s + dy * c) <= obb.hh;
}

/** What the e2e lane reads off a production build (`__overheadProbe`); read-only. */
export interface OverheadProbe {
  /** `overlayContainer`'s children, bottom to top. */
  stack: string[];
  /** The label of the stencil the overhead art wears, or null (the fog above covers it now). */
  mask: string | null;
  /** True while core's overhead container is lifted out of the world. False since the Lighting pass. */
  lifted: boolean;
  props: { childId: string; alpha: number; tint: number }[];
}

export function mountOverheadLayer(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const overhead = sceneGraph.overheadContainer;
  /** The alpha each faded prop is easing from; a prop at full strength has no entry. */
  const fades = new Map<string, number>();

  const tick = (ticker: Ticker) => {
    const { session } = useSessionStore.getState();
    // Any token this seat holds counts: the wire already drops the ones a player may not see.
    const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, session?.activeSceneId);
    for (const { childId, obb } of overheadEntries()) {
      const target = tokens.some((t) => obbContains(obb, t.x, t.y)) ? OVERHEAD_FADE : 1;
      const from = fades.get(childId) ?? 1;
      if (from === target) continue;
      const next = approach(from, target, ticker.deltaMS, FADE_MS);
      if (next === 1) fades.delete(childId);
      else fades.set(childId, next);
      setOverheadFade(childId, next);
    }
  };

  const probe = (): OverheadProbe => ({
    stack: sceneGraph.overlayContainer.children.map((c) => String(c.label)),
    mask: overhead.mask instanceof Container ? String(overhead.mask.label) : null,
    lifted: overhead.parent !== null && !isInWorld(overhead, sceneGraph.worldContainer),
    props: overheadEntries().map(({ childId, sprite }) => ({
      childId,
      alpha: sprite.alpha,
      tint: Number(sprite.tint),
    })),
  });
  const debug = window as Window & { __overheadProbe?: () => OverheadProbe };
  debug.__overheadProbe = probe;

  const ticker = engine.ticker();
  ticker.add(tick);

  return () => {
    if (debug.__overheadProbe === probe) delete debug.__overheadProbe;
    // The engine may already be gone (GameRenderer unmounting first), and touching its
    // destroyed objects throws; there is nothing left to hand back in that case.
    try {
      ticker.remove(tick);
      for (const childId of fades.keys()) setOverheadFade(childId, 1);
    } catch {
      /* engine torn down first */
    }
    fades.clear();
  };
}

/** Whether `node` sits somewhere under `world`. */
function isInWorld(node: Container, world: Container): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === world) return true;
  return false;
}

/** Mount for as long as an engine exists (`mountWhenEngineReady`); returns the cleanup. */
export const mountOverheadLayerWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountOverheadLayer, pollMs);
