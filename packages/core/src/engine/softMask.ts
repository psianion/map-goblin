// A soft piece's edge mask, worked out texel by texel (softPiece.ts uploads it). No Pixi, no
// DOM: it runs as it is in tests.
//
// The edge is a true ramp, not steps: each texel inside the piece's outline takes its exact
// distance to the nearest texel outside (Felzenszwalb and Huttenlocher's distance transform,
// linear in the texels), and the edge value is that distance over the soft edge's width. A
// fade is the same over its own box, eased with a smoothstep so it has no crease at its rim
// or its core. Red holds the edge, green what the fades leave; the shader reads both as they
// are, filtered linearly, so nothing between two texels jumps.

import type { Polygon } from '../types/geometry';
import type { PieceFade } from '../store/types';
import { fadeDepthOf } from '../shared/pieceFades';

/** Where a mask lies: its top-left corner (cells), texels per cell, and its size in texels. */
export interface MaskGrid {
  x: number;
  y: number;
  res: number;
  width: number;
  height: number;
}

/** Squared distance standing for "no texel outside reaches here". */
const FAR = 1e20;

function boxOf(rings: readonly Polygon[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < box.minX) box.minX = x;
      if (y < box.minY) box.minY = y;
      if (x > box.maxX) box.maxX = x;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

/**
 * The grid a mask for `outline` is drawn on: the outline's box and `pad` cells around it, at
 * `perCell` texels a cell, coarser when its longer side would pass `maxDim` texels. Null for
 * an empty outline.
 */
export function maskGridFor(outline: readonly Polygon[], pad: number, perCell: number, maxDim: number): MaskGrid | null {
  const b = boxOf(outline);
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  if (!(w > 0) || !(h > 0)) return null;
  const res = Math.min(perCell, maxDim / Math.max(w, h));
  return { x: b.minX - pad, y: b.minY - pad, res, width: Math.max(1, Math.ceil(w * res)), height: Math.max(1, Math.ceil(h * res)) };
}

/**
 * Which texels of a `w` x `h` grid, corner (x0, y0) at `res` a cell, have their centre inside
 * `rings` (even-odd, so a hole is outside): 1 inside. Each edge flips the texels right of
 * where it crosses a row, and a running parity along the row reads them off.
 */
export function insideTexels(rings: readonly Polygon[], x0: number, y0: number, res: number, w: number, h: number): Uint8Array {
  const flips = new Uint8Array((w + 1) * h);
  for (const ring of rings) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const [ax, ay] = ring[k];
      const [bx, by] = ring[(k + 1) % n];
      if (ay === by) continue;
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      // Rows whose centre lies in [lo, hi): a vertex shared by two edges is crossed once.
      const j0 = Math.max(0, Math.ceil((lo - y0) * res - 0.5));
      const j1 = Math.min(h - 1, Math.ceil((hi - y0) * res - 0.5) - 1);
      const slope = (bx - ax) / (by - ay);
      for (let j = j0; j <= j1; j++) {
        const x = ax + (y0 + (j + 0.5) / res - ay) * slope;
        const i = Math.min(w, Math.max(0, Math.ceil((x - x0) * res - 0.5)));
        flips[j * (w + 1) + i] ^= 1;
      }
    }
  }
  const inside = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    let on = 0;
    const row = j * (w + 1);
    for (let i = 0; i < w; i++) {
      on ^= flips[row + i];
      inside[j * w + i] = on;
    }
  }
  return inside;
}

/** One line of the transform: `f` (squared distances, in place) lowered to its envelope of parabolas. */
function line(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    // z[0] is -Infinity, so this stops at the first parabola at the latest.
    while (s <= z[k]) {
      k--;
      p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
  for (let q = 0; q < n; q++) f[q] = d[q];
}

/**
 * For each texel inside, its distance in texels to the nearest texel centre outside; 0 for a
 * texel outside. Texels past the grid count as inside, so a grid with no texel outside has
 * every distance far.
 */
export function distanceInside(inside: Uint8Array, w: number, h: number): Float32Array {
  const sq = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) sq[i] = inside[i] ? FAR : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = sq[j * w + i];
    line(f, h, d, v, z);
    for (let j = 0; j < h; j++) sq[j * w + i] = f[j];
  }
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const row = j * w;
    for (let i = 0; i < w; i++) f[i] = sq[row + i];
    line(f, w, d, v, z);
    for (let i = 0; i < w; i++) out[row + i] = Math.sqrt(f[i]);
  }
  return out;
}

/** Eases a fade's rise: flat at its rim and at its core, so neither shows as a line. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** Multiplies what `fade` leaves into `keep`, over the part of the grid its box covers. */
function applyFade(keep: Float32Array, grid: MaskGrid, fade: PieceFade): void {
  const { res, width: W, height: H } = grid;
  const rings = boxOf(fade.rings);
  const box = { ...rings };
  if (fade.within) {
    const wb = boxOf(fade.within);
    box.minX = Math.max(box.minX, wb.minX);
    box.minY = Math.max(box.minY, wb.minY);
    box.maxX = Math.min(box.maxX, wb.maxX);
    box.maxY = Math.min(box.maxY, wb.maxY);
  }
  // The texels the fade can change: its box, kept to `within`'s and to the mask.
  const oi0 = Math.max(0, Math.floor((box.minX - grid.x) * res));
  const oj0 = Math.max(0, Math.floor((box.minY - grid.y) * res));
  const oi1 = Math.min(W, Math.ceil((box.maxX - grid.x) * res));
  const oj1 = Math.min(H, Math.ceil((box.maxY - grid.y) * res));
  if (!(oi1 > oi0) || !(oj1 > oj0)) return;
  // The texels the distances are taken over: those and the feather around them, inside the
  // rings' box and a texel. A texel outside further off cannot change a distance that matters.
  const feather = Math.max(0, fade.feather) * res;
  const margin = Math.ceil(feather) + 1;
  const i0 = Math.max(oi0 - margin, Math.floor((rings.minX - grid.x) * res) - 1);
  const j0 = Math.max(oj0 - margin, Math.floor((rings.minY - grid.y) * res) - 1);
  const i1 = Math.min(oi1 + margin, Math.ceil((rings.maxX - grid.x) * res) + 1);
  const j1 = Math.min(oj1 + margin, Math.ceil((rings.maxY - grid.y) * res) + 1);
  const w = i1 - i0;
  const h = j1 - j0;
  const x0 = grid.x + i0 / res;
  const y0 = grid.y + j0 / res;
  const inside = insideTexels(fade.rings, x0, y0, res, w, h);
  const within = fade.within ? insideTexels(fade.within, x0, y0, res, w, h) : null;
  const dist = feather > 0 ? distanceInside(inside, w, h) : null;
  const depth = fadeDepthOf(fade);
  for (let j = oj0; j < oj1; j++) {
    for (let i = oi0; i < oi1; i++) {
      const k = (j - j0) * w + (i - i0);
      if (!inside[k] || (within && !within[k])) continue;
      // The texel centre's distance to the outline: half a texel short of the texel outside.
      const t = dist ? Math.min(1, Math.max(0, (dist[k] - 0.5) / feather)) : 1;
      keep[j * W + i] *= 1 - depth * ease(t);
    }
  }
}

/**
 * A piece's mask on `grid`, as RGBA bytes row by row from the top: red the edge, rising from
 * 0 at `outline` to full `soft` cells inside (0 outside; full throughout with no `soft`, the
 * piece's own outline cutting it then), blue the same, green what `fades` leave (full with
 * none), alpha full.
 */
export function softMaskPixels(outline: readonly Polygon[], soft: number, fades: readonly PieceFade[], grid: MaskGrid): Uint8Array {
  const { x, y, res, width: W, height: H } = grid;
  const n = W * H;
  const out = new Uint8Array(n * 4);
  const ramp = soft * res;
  if (ramp > 0) {
    const dist = distanceInside(insideTexels(outline, x, y, res, W, H), W, H);
    // The texel centre's distance to the outline: half a texel short of the texel outside.
    for (let k = 0; k < n; k++) out[k * 4] = Math.round(255 * Math.min(1, Math.max(0, (dist[k] - 0.5) / ramp)));
  } else {
    for (let k = 0; k < n; k++) out[k * 4] = 255;
  }
  let keep: Float32Array | null = null;
  if (fades.length > 0) {
    keep = new Float32Array(n).fill(1);
    for (const fade of fades) applyFade(keep, grid, fade);
  }
  for (let k = 0; k < n; k++) {
    out[k * 4 + 1] = keep ? Math.round(255 * keep[k]) : 255;
    out[k * 4 + 2] = out[k * 4];
    out[k * 4 + 3] = 255;
  }
  return out;
}

/** How far `b` lies from `a` when it is `a` moved and nothing else, cells; null otherwise. */
function offsetOf(a: readonly Polygon[], b: readonly Polygon[], at: [number, number] | null): [number, number] | null {
  if (a.length !== b.length) return null;
  let off = at;
  for (let r = 0; r < a.length; r++) {
    const ra = a[r];
    const rb = b[r];
    if (ra.length !== rb.length) return null;
    for (let i = 0; i < ra.length; i++) {
      const dx = rb[i][0] - ra[i][0];
      const dy = rb[i][1] - ra[i][1];
      if (!off) off = [dx, dy];
      else if (Math.abs(dx - off[0]) > 1e-9 || Math.abs(dy - off[1]) > 1e-9) return null;
    }
  }
  return off ?? [0, 0];
}

/**
 * How far a piece moved, cells, when its outline and fades are what they were moved and
 * nothing else, so its mask can be laid again where it now is; null when anything else changed.
 */
export function movedBy(
  was: { outline: readonly Polygon[]; fades: readonly PieceFade[] },
  now: { outline: readonly Polygon[]; fades: readonly PieceFade[] },
): [number, number] | null {
  let off = offsetOf(was.outline, now.outline, null);
  if (!off || was.fades.length !== now.fades.length) return null;
  for (let i = 0; i < was.fades.length && off; i++) {
    const a = was.fades[i];
    const b = now.fades[i];
    if (Math.abs(a.feather - b.feather) > 1e-9 || fadeDepthOf(a) !== fadeDepthOf(b) || !a.within !== !b.within) return null;
    off = offsetOf(a.rings, b.rings, off);
    if (off && a.within && b.within) off = offsetOf(a.within, b.within, off);
  }
  return off;
}
