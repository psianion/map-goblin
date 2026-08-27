// The x-ray preview a band-joint drag runs behind (spec step 6).
//
// Nothing is written to the map until pointer-up, so the only way the DM can
// see what the kit decided is to draw it: the candidate pieces as ghosts at
// their solved placements, the rock they would replace faded to about the same,
// and the stretch of floor outline that moves dashed in over the top.
//
// Overlay only. The ghosts are throwaway sprites in a container of this
// module's own, and the fade is a render-side alpha on live sprites — never a
// field on a child, or a cancelled drag would leave translucent rock on the map
// with nothing to undo it.

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { GRID_CELL_PX } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import { bandPieceArt } from './bandCommit';
import type { BandSolveResult } from './bandSolver';
import type { CaveBand, Vec } from './caveBand';
import { strokeRopeDash } from './overlayDraw';
import { setAssetChildrenAlpha } from './subscribeToAssets';

/** X-ray: enough to read the new rock through the old, and the old through it. */
const GHOST_ALPHA = 0.35;

let container: Container | null = null;
let outline: Graphics | null = null;
let ghosts: Sprite[] = [];
/**
 * One label per ghost slot, kept between moves rather than rebuilt with them.
 * Constructing a Text measures canvas glyphs and a drag emits a pointermove
 * every few pixels, so a fresh set per move would cost more than the solve. Held
 * by slot rather than by name because a run of straights ghosts the same piece
 * several times over, and a Text can only be in one place.
 */
const labels: Text[] = [];
/** Live children currently faded, so the restore is exact rather than a guess. */
let faded: { layerId: string; ids: string[] } | null = null;

/** Wire the world-space container the ghosts live in (see sceneGraph). */
export function initBandGhostPreview(c: Container): void {
  clearBandGhosts();
  container = c;
  container.label = 'bandGhostPreview';
  outline = new Graphics();
  container.addChild(outline);
  for (const t of labels) t.destroy();
  labels.length = 0;
}

/** Screen pixels per world unit, read off the container's own place in the scene. */
function zoomOf(c: Container): number {
  const z = c.worldTransform.a;
  return Number.isFinite(z) && z > 0 ? z : 1;
}

function labelAt(slot: number, key: string): Text {
  const want = key.replace(/_/g, ' ');
  let text = labels[slot];
  if (!text) {
    text = new Text({
      text: want,
      style: new TextStyle({
        fontFamily: 'IBM Plex Mono, Consolas, monospace',
        fontSize: 10,
        fill: 0xffffff,
      }),
      resolution: 2,
    });
    labels[slot] = text;
  }
  // Guarded: assigning re-measures the glyphs, and through most of a drag the
  // walk keeps handing back the same names in the same order.
  if (text.text !== want) text.text = want;
  return text;
}

/**
 * Draw the answer the solver just gave, or take the preview down.
 *
 * A refusal draws nothing and puts the live band back to full strength: the
 * status bar carries the reason, and half-faded rock with no ghosts over it
 * would read as a bug rather than a "no".
 */
export function showBandGhosts(
  layerId: string,
  band: CaveBand,
  contour: readonly Vec[],
  result: BandSolveResult | null,
): void {
  clearGhostNodes();
  if (!container || !outline || !result?.ok) {
    restoreFade();
    return;
  }
  const zoom = zoomOf(container);

  // The span this replaces, faded so the ghosts read as the swap rather than as
  // extra rock piled on top.
  const n = band.pieces.length;
  const ids = Array.from(
    { length: result.count },
    (_, m) => band.pieces[(result.from + m) % n].childId,
  );
  if (faded && (faded.layerId !== layerId || faded.ids.join() !== ids.join())) restoreFade();
  faded = { layerId, ids };
  setAssetChildrenAlpha(layerId, ids, GHOST_ALPHA);

  for (const [slot, p] of result.pieces.entries()) {
    const art = bandPieceArt(p.piece.key);
    if (!art) continue;
    const sprite = new Sprite(resolveTexture(art.id));
    sprite.anchor.set(0.5, 0.5);
    sprite.alpha = GHOST_ALPHA;
    sprite.position.set(p.at.position.x, p.at.position.y);
    sprite.rotation = p.at.rotation;
    sprite.width = (art.naturalWidth / GRID_CELL_PX) * p.at.scale;
    sprite.height = (art.naturalHeight / GRID_CELL_PX) * p.at.scale;
    // Same as syncSprite: the flip is applied after the size, because the
    // width/height setters rewrite scale outright.
    if (p.at.flipY) sprite.scale.y *= -1;
    container.addChild(sprite);
    ghosts.push(sprite);

    const text = labelAt(slot, p.piece.key);
    text.scale.set(1 / zoom);
    text.position.set(p.at.position.x + 6 / zoom, p.at.position.y - 6 / zoom);
    text.alpha = 0.85;
    container.addChild(text);
  }

  // The floor edge, in the overlay's own dash language: the rock is what the DM
  // is looking at, but the outline is what actually moved, and without it a
  // small drag reads as the stones sliding for no reason.
  outline.clear();
  const stretch = movedStretch(contour, result.contour);
  if (stretch.length > 1) strokeRopeDash(outline, stretch, false, zoom);
  // Re-added, which moves it to the top: the dashes have to read over the rock,
  // and the ghosts were parented after it.
  container.addChild(outline);
}

/**
 * The run of outline the edit displaced, walked from the last untouched point
 * before it to the first untouched point after.
 *
 * Both anchors are included on purpose: without them the dash floats a point
 * short of the floor edge at each end and reads as a separate line rather than
 * as a piece of the outline. Walked round the ring rather than sliced, because
 * a stretch near the seam wraps index 0.
 */
export function movedStretch(before: readonly Vec[], after: readonly Vec[]): [number, number][] {
  if (before.length !== after.length) return [];
  const n = after.length;
  const moved = after.map((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1]) > 1e-9);
  const still = moved.indexOf(false);
  // Nothing moved, or everything did — neither is a stretch to outline.
  if (!moved.includes(true) || still < 0) return [];
  let from = still;
  while (!moved[(from + 1) % n]) from = (from + 1) % n;
  const out: [number, number][] = [[after[from][0], after[from][1]]];
  for (let i = (from + 1) % n; ; i = (i + 1) % n) {
    out.push([after[i][0], after[i][1]]);
    if (!moved[i]) break;
  }
  return out;
}

function clearGhostNodes(): void {
  for (const sprite of ghosts) {
    sprite.removeFromParent();
    sprite.destroy();
  }
  ghosts = [];
  // Labels are pooled, not thrown away — only unparented.
  for (const text of labels) text.removeFromParent();
}

function restoreFade(): void {
  if (!faded) return;
  setAssetChildrenAlpha(faded.layerId, faded.ids, 1);
  faded = null;
}

/** Take the whole preview down: ghosts, labels, dashes and the fade. */
export function clearBandGhosts(): void {
  clearGhostNodes();
  outline?.clear();
  restoreFade();
}
