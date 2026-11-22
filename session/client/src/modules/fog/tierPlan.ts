// The fog mask as a *description* of draws, computed without a GPU and without Clipper.
//
// This is the pure half of the tier compositor. The mask is the frame minus the cleared cells of
// the level shown: the cleared record goes into `mask` as one texel per cell, the feather is
// `mask` blurred into `edge`, and the scrim is a flat black backstop with `mask` erased out of
// it. A seat's own token is painted back over all of that, so a player always sees their own.
//
// No Pixi in here. `tierCompositor.ts` is the executor and holds every Pixi object.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { toBytes, type RegionMask } from '@dnd/mechanics/fog';
import type { Bounds } from './FogRenderer';
import { regionCells } from './fog';

/**
 * The mask's live tier. White, as it has always been.
 *
 * Stated here rather than imported so this module keeps its promise of pulling in no Pixi —
 * `livingFog.ts` owns the shader and imports the renderer. `tierPlan.test.ts` pins the two
 * against each other, which is the only place the equality actually has to hold.
 */
export const MASK_LIVE = 0xffffff;

/**
 * P8 — how far, in cells, every boundary with hidden ground feathers inward.
 *
 * The cloud used to meet the seen ground on a hard line: the shader read hidden texels flat at
 * 0 and floored every shown texel at the memory grey, so the step from hidden to shown was the
 * mask's own edge — the sweep's polygon to the pixel, or the record's cells through a one-cell
 * bilinear tent. The `edge` target is the mask's coverage blurred by this much, and the shader
 * scales the tier by `edgeFeather` of it, so the cover thins from dense to the tier's own mist
 * over this distance instead. Inward only: at the boundary itself the factor is 0, so nothing
 * outside what the geometry shows is ever lifted. Every grown edge (a sweep, a held room) spends
 * it inside the `FOG_FEATHER` band it already carries; a record edge, inside the extra cell the
 * record keeps past the ground. The cost: a region much narrower than twice this stays misty.
 *
 * T8 — this is a Pixi BlurFilter strength (σ = `BLUR_SIGMA_PER_STRENGTH` × it): 0.9 puts the
 * fade from 5 % to 95 % over about 1.5 cells, and the Gaussian is what takes the record's cell
 * staircase out of the edge (`shownAt`).
 */
export const EDGE_FEATHER_CELLS = 0.9;

/** Pixi's 5-tap BlurFilter, all passes together: σ in texels per unit of `strength`. */
export const BLUR_SIGMA_PER_STRENGTH = Math.sqrt(2 * (0.221461 + 4 * 0.153388));

/** Where `edgeFeather` starts: a blurred straight edge reads exactly half here, on the line. */
export const EDGE_FEATHER_FROM = 0.5;

/**
 * The feather factor for a blurred coverage value — the shader's `edgeAt`, written once here so
 * a test can read it. 0 at and outside the boundary, 1 a feather deep, smooth at both ends.
 */
export function edgeFeather(coverage: number): number {
  const t = Math.min(1, Math.max(0, (coverage - EDGE_FEATHER_FROM) / (1 - EDGE_FEATHER_FROM)));
  return t * t * (3 - 2 * t);
}

/**
 * T13 — the guard's own blur, a BlurFilter strength in cells (σ ≈ 0.26 cell). The player seat's
 * soft copy of the mask (`maskSoft`, read as coverage) is blurred by this much, and the guard
 * reads that copy. The feather alone would lift a hidden cell inside revealed ground; T8 held it
 * with the hard texel (`4 × mask`), which stepped from dense cloud to the feather in one texel —
 * the hard white sliver in a thin hidden gap. Read off this blur, the guard eases instead.
 */
export const GUARD_BLUR_CELLS = 0.2;

/** T13 — the guard is 0 where the soft copy reads at or under this (a boundary reads half)… */
export const GUARD_FROM = 0.5;
/** …and 1 from here: a few tenths of a cell inside shown ground, where the feather is still ~0. */
export const GUARD_TO = 0.8;

/** T13 — the guard for a soft-copy value: the shader's `guardAt`. */
export function guardAt(soft: number): number {
  const t = Math.min(1, Math.max(0, (soft - GUARD_FROM) / (GUARD_TO - GUARD_FROM)));
  return t * t * (3 - 2 * t);
}

/**
 * T8 — how shown a point reads on the player's seat, 0 hidden to 1 revealed: the shader's
 * one-tier `maskAt`. `soft` is the guard's blurred copy (T13), `coverage` the feather's blur.
 */
export function shownAt(soft: number, coverage: number): number {
  return edgeFeather(coverage) * guardAt(soft);
}

/** T13 — how far past the token's own edge its clearing fades out, in cells (5–95 % over ~1.5). */
export const OWN_CLEAR_FEATHER = 2;

/** T13 — one of the seat's own tokens as the shader clears it: clear to `inner`, gone by `outer`. */
export interface OwnClearing {
  x: number;
  y: number;
  inner: number;
  outer: number;
}

/** T13 — a token footprint (§2.8) as its round clearing, centred on the footprint. */
export function ownClearing(footprint: Polygon): OwnClearing {
  const xs = footprint.map((p) => p[0]);
  const ys = footprint.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inner = Math.max(maxX - minX, maxY - minY) / 2;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, inner, outer: inner + OWN_CLEAR_FEATHER };
}

/**
 * T13 — how clear the seat's own tokens leave a point: 1 over the token, easing to 0 at `outer`.
 * The shader's `ownAt`, taken after the coastline warp, so the clearing stays on the token.
 */
export function ownClearAt(x: number, y: number, own: readonly OwnClearing[]): number {
  let best = 0;
  for (const o of own) {
    const t = Math.min(1, Math.max(0, (Math.hypot(x - o.x, y - o.y) - o.inner) / Math.max(o.outer - o.inner, 1e-3)));
    best = Math.max(best, 1 - t * t * (3 - 2 * t));
  }
  return best;
}

/**
 * T13 — the ground a clearing may show, as a polygon round its outer circle (circumscribed, so
 * it covers the whole disc): the scrim's hole under it.
 */
export function ownDisc(o: OwnClearing, sides = 32): Polygon {
  const r = o.outer / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return [o.x + r * Math.cos(a), o.y + r * Math.sin(a)] as [number, number];
  });
}

/**
 * T6 — how many passes a mask blur of `strength` texels needs to come out a gradient.
 *
 * Pixi 8's BlurFilter samples five taps per pass, the first pass `strength / 1.15` texels
 * apart and each later one half the last. A hard edge through it is a staircase whose treads
 * are the last pass's spacing: P8's feather (24 texels at three passes) stepped every five
 * texels, which read as low-res pixels, and the coastline warp slid the steps about. Enough
 * passes to bring the last spacing under one texel leave the linear sampler a ramp. Paid per
 * mask rebuild, never per frame.
 */
export function blurPasses(strength: number): number {
  let sum = 1;
  for (let passes = 1; passes < 8; passes++) {
    if (strength / Math.sqrt(sum) / 2 ** (passes - 1) <= 1) return passes;
    sum += 4 ** -passes;
  }
  return 8;
}

/** T6 — how far past the map's edge its shadow on the cloud reaches, in cells. */
export const FRAME_SHADOW_CELLS = 1.25;

/** T6 — how far the cloud right against the edge is pulled toward its shaded base. */
export const FRAME_SHADOW_DEPTH = 0.5;

/**
 * T6 — the map's shadow on the cloud at a point: 0 anywhere on the map, `FRAME_SHADOW_DEPTH`
 * on its edge, easing out to 0 at `FRAME_SHADOW_CELLS` past it (rounded at the corners). The
 * shader's `frameShadow`, written once here so a test can read it.
 */
export function frameShadow(x: number, y: number, frame: Bounds): number {
  const dx = Math.max(frame.minX - x, x - frame.maxX, 0);
  const dy = Math.max(frame.minY - y, y - frame.maxY, 0);
  const d = Math.hypot(dx, dy);
  if (d <= 0) return 0;
  const t = 1 - Math.min(1, d / FRAME_SHADOW_CELLS);
  return FRAME_SHADOW_DEPTH * t * t;
}

/**
 * T6 — where the shader reads the tier for a point: held on the map, `inset` in from its edge.
 * Neither the bilinear tap nor the coastline warp can then pull the void past the frame in
 * over the map; the cover past the edge is the shader's own hard cut instead. The shader's
 * `onMapSample`.
 */
export function onMapSample(x: number, y: number, frame: Bounds, inset: number): [number, number] {
  return [
    Math.min(frame.maxX - inset, Math.max(frame.minX + inset, x)),
    Math.min(frame.maxY - inset, Math.max(frame.minY + inset, y)),
  ];
}

/** The two native blends P0 proved into a RenderTexture on 8.17. Nothing else is allowed. */
export type Blend = 'normal' | 'erase';

/**
 * The render targets a plan draws into, in the order they must be executed — a target may
 * only ever sample one that comes before it.
 *
 * - `mask`: the texture the cloud shader samples, and the stencil the tokens and doors wear.
 *   Clears *transparent*, so alpha carries shown-ness and an erased texel reads 0 in `.r`.
 * - `edge`: the mask's coverage blurred, for the shader's inward feather.
 * - `scrim`: the flat black backstop, with the mask's own alpha erased out of it.
 */
export type TierTarget = 'mask' | 'edge' | 'scrim';

export const TARGET_ORDER: readonly TierTarget[] = ['mask', 'edge', 'scrim'];

/**
 * The cleared record as texture bytes: one RGBA texel per cell, opaque white where the bit is
 * set and transparent black where it is not.
 *
 * Premultiplied by construction (both values are fixed points of the multiply), which is what
 * makes the linear upscale correct — a texture with unpremultiplied colour under a transparent
 * texel bleeds that colour into its neighbours.
 *
 * Texel (col, row) is the world square `[minX + col, minX + col + 1] × [minY + row, ...]`, the
 * `cellsCoveredByPolygon` convention, so a brushed cell and a swept cell are the same cell.
 */
export interface CellTexture {
  data: Uint8Array;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
}

export type DrawOp =
  /** Flat colour over a world rect — the cover fills. */
  | { kind: 'rect'; target: TierTarget; rect: Bounds; color: number; blend: Blend }
  /**
   * Polygons filled and, when `grow > 0`, stroked round-joined at `2 * grow` — which is the
   * polygon ⊕ disc(grow).
   */
  | {
      kind: 'polys';
      target: TierTarget;
      polys: readonly Polygon[];
      grow: number;
      color: number;
      blend: Blend;
      /** The stroke alone, no fill: the band within `grow` of each ring. */
      outline?: boolean;
    }
  /** The record's cells, linearly upscaled. */
  | {
      kind: 'cells';
      target: TierTarget;
      cells: CellTexture;
      blurCells: number;
      color: number;
      blend: Blend;
    }
  /**
   * One target composited into another over the whole cover. With `featherCells` the source is
   * read as coverage (shown or not) and blurred by that many cells.
   */
  | { kind: 'sprite'; target: TierTarget; source: TierTarget; blend: Blend; featherCells?: number };

export interface DrawPlan {
  /** The world rect every target covers: the frame, grown by `COVER_MARGIN`. Null: no frame. */
  cover: Bounds | null;
  ops: readonly DrawOp[];
  /** How many cells the record clears — `__fogProbe.clearedCells`. */
  cells: number;
  /**
   * The cover past the map's edge (`outsideFrame`), which both blurred copies (`maskSoft` and the
   * `edge` feather) read as shown. The mask itself stays empty there; the blurs only stop fading
   * the cleared ground toward the edge, where the shader cuts the cover hard instead.
   */
  beyond?: readonly Bounds[];
}

/** What the compositor needs to know about a seat's fog. */
export interface TierScene {
  /** The map frame (`fogFrame`). Null ⇒ nothing is drawn. */
  frame: Bounds | null;
  /** The cleared cells of the level shown, on the frame's grid. Absent: nothing cleared. */
  cleared?: RegionMask;
  /** This seat's own tokens' footprints: always clear, whatever the record says. */
  own?: readonly Polygon[];
}

/** How far past the frame the targets reach, in cells: room for the feather to run out. */
export const COVER_MARGIN = 2;

const usable = (polys: readonly Polygon[]): Polygon[] => polys.filter((p) => p.length >= 3);

/**
 * The cover outside the frame, as up to four strips — what the blurs read as shown, so cleared
 * ground running up to the map's edge does not fade toward it.
 */
export function outsideFrame(cover: Bounds, frame: Bounds): Bounds[] {
  return [
    { minX: cover.minX, minY: cover.minY, maxX: cover.maxX, maxY: frame.minY },
    { minX: cover.minX, minY: frame.maxY, maxX: cover.maxX, maxY: cover.maxY },
    { minX: cover.minX, minY: frame.minY, maxX: frame.minX, maxY: frame.maxY },
    { minX: frame.maxX, minY: frame.minY, maxX: cover.maxX, maxY: frame.maxY },
  ].filter((r) => r.maxX > r.minX && r.maxY > r.minY);
}

/**
 * The record's bits, one RGBA texel per cell. Null when there is no record or nothing set in
 * it — an empty record is no draw at all rather than a transparent one.
 */
export function cellTexture(region: RegionMask | undefined): CellTexture | null {
  if (!region || region.cols <= 0 || region.rows <= 0) return null;
  const bytes = toBytes(region.bits);
  const count = region.cols * region.rows;
  const data = new Uint8Array(count * 4);
  let any = false;
  for (let bit = 0; bit < count; bit++) {
    if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue;
    any = true;
    data.fill(255, bit * 4, bit * 4 + 4);
  }
  return any ? { data, cols: region.cols, rows: region.rows, minX: region.minX, minY: region.minY } : null;
}

/**
 * The whole fog mask, as draws: the cleared cells, the seat's own tokens over them, the feather
 * off the finished mask, and the scrim as one erase of it, so the two cannot disagree about
 * where a hole is. A pass that does not run leaves the scrim opaque: fog fails dark.
 */
export function tierPlan(scene: TierScene): DrawPlan {
  const cells = regionCells(scene.cleared);
  const frame = scene.frame;
  if (!frame) return { cover: null, ops: [], cells };
  const cover = {
    minX: frame.minX - COVER_MARGIN,
    minY: frame.minY - COVER_MARGIN,
    maxX: frame.maxX + COVER_MARGIN,
    maxY: frame.maxY + COVER_MARGIN,
  };
  const own = usable(scene.own ?? []);
  const cleared = cellTexture(scene.cleared);
  const ops: DrawOp[] = [];
  if (cleared) ops.push({ kind: 'cells', target: 'mask', cells: cleared, blurCells: 0, color: MASK_LIVE, blend: 'normal' });
  if (own.length > 0) ops.push({ kind: 'polys', target: 'mask', polys: own, grow: 0, color: MASK_LIVE, blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'edge', source: 'mask', blend: 'normal', featherCells: EDGE_FEATHER_CELLS });
  ops.push({ kind: 'rect', target: 'scrim', rect: cover, color: 0x000000, blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' });
  // …and the own clearing's disc, so its feather fades into the map, not into the backstop.
  if (own.length > 0) {
    ops.push({ kind: 'polys', target: 'scrim', polys: own.map((f) => ownDisc(ownClearing(f))), grow: 0, color: MASK_LIVE, blend: 'erase' });
  }
  return { cover, ops, cells, beyond: outsideFrame(cover, frame) };
}
