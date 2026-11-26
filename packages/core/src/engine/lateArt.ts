// Art that lands after a layer was drawn.
//
// A map opens before its packs' art has decoded, and the art lands in batches over the next
// seconds. A rock piece drawn before its art landed is laid all the same, hidden, and takes its
// texture in place when the art lands (`swapWhenLanded`): nothing is laid or drawn again. What
// cannot be swapped in (a floor drawn in its colour, a stone wall) is drawn again once the
// arrivals have settled (`afterArtSettles`): a frame passes with no more art landing, then each
// layer that waited is drawn once, however many batches came.

import type { Texture } from 'pixi.js';
import { resolveTexture } from '../assets/textureLoader';
import { getAssetPackManager } from './assetPackInstance';

/** Pieces waiting on their art, by texture id: each takes it when it lands. */
const swaps = new Map<string, Set<(texture: Texture) => void>>();
/** What is drawn again once the arrivals settle, by what it draws. */
const pending = new Map<string, () => void>();
let watched: unknown = null;
let ticking = false;
/** Art landed since the last frame looked. */
let landed = false;

function watch(): void {
  const manager = getAssetPackManager();
  if (watched === manager) return;
  watched = manager;
  swaps.clear();
  pending.clear();
  manager.subscribeTextures(() => {
    for (const [id, waiting] of [...swaps]) {
      const texture = resolveTexture(id);
      if (texture.width <= 1) continue;
      swaps.delete(id);
      for (const apply of waiting) apply(texture);
    }
    if (pending.size > 0) arrived();
  });
}

const nextFrame = (run: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
};

function arrived(): void {
  landed = true;
  if (ticking) return;
  ticking = true;
  nextFrame(tick);
}

function tick(): void {
  if (landed) {
    landed = false;
    nextFrame(tick);
    return;
  }
  ticking = false;
  const runs = [...pending.values()];
  pending.clear();
  for (const run of runs) run();
}

/** `apply` is handed the texture `textureId` names when it lands; `apply` itself checks it is still wanted. */
export function swapWhenLanded(textureId: string, apply: (texture: Texture) => void): void {
  watch();
  let waiting = swaps.get(textureId);
  if (!waiting) swaps.set(textureId, (waiting = new Set()));
  waiting.add(apply);
}

/**
 * Runs `draw` once the art landing now has settled: a frame after the last batch. Asked again
 * under the same `key` before then, it still runs once.
 */
export function afterArtSettles(key: string, draw: () => void): void {
  watch();
  pending.set(key, draw);
  arrived();
}
