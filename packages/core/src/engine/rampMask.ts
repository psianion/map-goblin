// The engine's fades as true ramps: each one a field of opacity worked out texel by texel over
// a grid (softMask.ts's), from each texel's distance to an outline or to a line, eased so it has
// no crease at either end. Never a stack of flat regions: two neighbouring texels differ by no
// more than the fade's slope allows, and the GPU filters between them linearly. No Pixi, no
// DOM: tests sample a field the way that filter does (`sampleRamp`). softPiece.ts draws them.

import type { Polygon } from '../types/geometry';
import { distanceInside, ease, insideTexels, maskGridFor, type MaskGrid } from './softMask';

type Vec = [number, number];

/** A fade's opacity over a grid, texel by texel, row by row from the top: 0 to 1. */
export interface RampField {
  grid: MaskGrid;
  alpha: Float32Array;
}

/** A fade as drawn: its field, and the region it is drawn within, crisp at that outline (null for the field's own box). */
export interface Ramp {
  field: RampField;
  clip: Polygon[] | null;
}

/** Texels per cell a ramp is worked out at, at most. */
export const RAMP_TEXELS_PER_CELL = 16;
/** A ramp's longest side, texels: a wider one is worked out coarser, and filtered up. */
const RAMP_MAX_DIM = 1024;

/** `x` kept to 0..1. */
export const unit = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** The grid a ramp over `rings` and `pad` cells round them is worked out on; null for nothing. */
export function rampGrid(rings: readonly Polygon[], pad: number, perCell = RAMP_TEXELS_PER_CELL, maxDim = RAMP_MAX_DIM): MaskGrid | null {
  return rings.length === 0 ? null : maskGridFor(rings, pad, perCell, maxDim);
}

/** A field of `grid`, each texel's opacity `at(x, y, k)` for its centre (x, y), cells, and its index. */
export function fieldOf(grid: MaskGrid, at: (x: number, y: number, k: number) => number): RampField {
  const { x, y, res, width: W, height: H } = grid;
  const alpha = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const cy = y + (j + 0.5) / res;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      alpha[k] = unit(at(x + (i + 0.5) / res, cy, k));
    }
  }
  return { grid, alpha };
}

/** The field at (x, y), cells, filtered between texel centres as the GPU filters it, held at its edge past it. */
export function sampleRamp(field: RampField, x: number, y: number): number {
  const { grid, alpha } = field;
  const { width: W, height: H, res } = grid;
  const u = (x - grid.x) * res - 0.5;
  const v = (y - grid.y) * res - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const at = (i: number, j: number): number => alpha[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  return (at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu) * (1 - fv) + (at(i0, j0 + 1) * (1 - fu) + at(i0 + 1, j0 + 1) * fu) * fv;
}

/** Inside `rings` by even-odd: a hole is outside. */
export function insideRings(rings: readonly Polygon[], [x, y]: Vec): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
    }
  }
  return hit;
}

/** Whether (x, y) lies in the box a grid covers. */
function inGrid(grid: MaskGrid, x: number, y: number): boolean {
  return x >= grid.x && y >= grid.y && x <= grid.x + grid.width / grid.res && y <= grid.y + grid.height / grid.res;
}

/** How opaque a ramp paints at `p`: its field, within its clip and its box; nothing elsewhere. */
export function rampAlphaAt(ramp: Ramp, p: Vec): number {
  if (ramp.clip && !insideRings(ramp.clip, p)) return 0;
  return inGrid(ramp.field.grid, p[0], p[1]) ? sampleRamp(ramp.field, p[0], p[1]) : 0;
}

/** Each texel's distance, cells, from its centre to the outline of `rings`, inside them; 0 outside. */
export function distanceIn(rings: readonly Polygon[], grid: MaskGrid): Float32Array {
  const { x, y, res, width: W, height: H } = grid;
  const inside = insideTexels(rings, x, y, res, W, H);
  const d = distanceInside(inside, W, H);
  // A texel centre lies half a texel short of the texel outside it.
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? Math.max(0, d[k] - 0.5) / res : 0;
  return d;
}

/** 1 for each texel whose centre lies inside `rings` (even-odd: a hole is outside). */
export function insideOf(rings: readonly Polygon[], grid: MaskGrid): Uint8Array {
  return insideTexels(rings, grid.x, grid.y, grid.res, grid.width, grid.height);
}

/** Each texel's distance, cells, from its centre to the outline of `rings`, outside them; 0 inside. */
export function distanceOut(rings: readonly Polygon[], grid: MaskGrid): Float32Array {
  const { x, y, res, width: W, height: H } = grid;
  const inside = insideTexels(rings, x, y, res, W, H);
  for (let k = 0; k < inside.length; k++) inside[k] ^= 1;
  const d = distanceInside(inside, W, H);
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? Math.max(0, d[k] - 0.5) / res : 0;
  return d;
}

/** How far back from an open line's end the way it runs out there is read, cells. */
const END_READ = 0.3;

/** A line a ramp is measured from: open, or closed back onto its first point. */
export interface RampLine {
  pts: Polygon;
  closed: boolean;
}

/** What `distanceToLines` found for each texel: how far its nearest line is, which one, and on which side. */
export interface LineDistances {
  /** Cells; Infinity past `reach` of every line. */
  d: Float32Array;
  /** The index of the nearest line; -1 for none. */
  owner: Int32Array;
  /** 1 where the texel lies on the right of the nearest line's travel. */
  right: Uint8Array;
  /** The nearest point of the nearest line, cells: what a fade's wander is read at, so it moves every texel along one normal alike. */
  qx: Float32Array;
  qy: Float32Array;
}

/**
 * Each texel's distance, cells, to the nearest of `lines` within `reach`, which line that is, and
 * whether the texel lies on the right of its travel (by the side of the stretch nearest it, or
 * at a joint by the two stretches' normals together, so a turn reads one side or the other).
 * With `butt`, an open line's two ends are cut square: nothing past either end, across the line's
 * direction there, is near the stretches that end it.
 */
export function distanceToLines(lines: readonly RampLine[], grid: MaskGrid, reach: number, butt = false): LineDistances {
  const { x: gx, y: gy, res, width: W, height: H } = grid;
  const d = new Float32Array(W * H).fill(Infinity);
  const owner = new Int32Array(W * H).fill(-1);
  const right = new Uint8Array(W * H);
  const nx0 = new Float32Array(W * H);
  const ny0 = new Float32Array(W * H);
  lines.forEach((line, li) => {
    const pts = line.pts.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-9);
    if (line.closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
    const n = pts.length;
    if (n < 2) return;
    const segs = line.closed ? n : n - 1;
    // Each stretch's right-hand normal, and each joint's: the two either side of it together.
    const normal: Vec[] = [];
    for (let s = 0; s < segs; s++) {
      const a = pts[s];
      const b = pts[(s + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      normal.push([-(b[1] - a[1]) / L, (b[0] - a[0]) / L]);
    }
    // An open line's ends, each with the way the line runs out through it (read over its last
    // END_READ, so a wrinkle in the last stretch does not turn it), and how far along the line
    // a stretch may lie and still be cut by it: the reach, and as far again for the wrinkles.
    const cut = butt && !line.closed;
    const cum = [0];
    for (let s = 0; s < segs; s++) cum.push(cum[s] + Math.hypot(pts[(s + 1) % n][0] - pts[s][0], pts[(s + 1) % n][1] - pts[s][1]));
    const total = cum[segs];
    const outward = (end: Vec, from: Vec): Vec => {
      const L = Math.hypot(end[0] - from[0], end[1] - from[1]);
      return L > 1e-9 ? [(end[0] - from[0]) / L, (end[1] - from[1]) / L] : [0, 0];
    };
    const along = (at: number): Vec => {
      let s = 0;
      while (s + 1 < segs && cum[s + 1] < at) s++;
      const u = cum[s + 1] > cum[s] ? (at - cum[s]) / (cum[s + 1] - cum[s]) : 0;
      return [pts[s][0] + (pts[s + 1][0] - pts[s][0]) * u, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * u];
    };
    const head = cut ? outward(pts[0], along(Math.min(total, END_READ))) : [0, 0];
    const tail = cut ? outward(pts[n - 1], along(Math.max(0, total - END_READ))) : [0, 0];
    const capReach = 2 * reach + END_READ;
    const joint = (v: number): Vec => {
      const before = line.closed ? normal[(v - 1 + segs) % segs] : normal[Math.max(0, v - 1)];
      const after = line.closed ? normal[v % segs] : normal[Math.min(segs - 1, v)];
      const sx = before[0] + after[0];
      const sy = before[1] + after[1];
      const L = Math.hypot(sx, sy);
      return L > 1e-9 ? [sx / L, sy / L] : after;
    };
    for (let s = 0; s < segs; s++) {
      const a = pts[s];
      const b = pts[(s + 1) % n];
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const L2 = vx * vx + vy * vy;
      const cutStart = cut && cum[s] < capReach;
      const cutEnd = cut && total - cum[s + 1] < capReach;
      const nA = joint(s);
      const nB = joint(s + 1);
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - gx) * res));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + reach - gx) * res));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - gy) * res));
      const j1 = Math.min(H - 1, Math.ceil((Math.max(a[1], b[1]) + reach - gy) * res));
      for (let j = j0; j <= j1; j++) {
        const py = gy + (j + 0.5) / res;
        for (let i = i0; i <= i1; i++) {
          const px = gx + (i + 0.5) / res;
          if (cutStart && (px - pts[0][0]) * head[0] + (py - pts[0][1]) * head[1] > 0) continue;
          if (cutEnd && (px - pts[n - 1][0]) * tail[0] + (py - pts[n - 1][1]) * tail[1] > 0) continue;
          const t = ((px - a[0]) * vx + (py - a[1]) * vy) / L2;
          // The nearest point of the stretch, and the normal the side is read by there.
          const end = t < 0 ? a : t > 1 ? b : null;
          const qx = end ? end[0] : a[0] + vx * t;
          const qy = end ? end[1] : a[1] + vy * t;
          const n2 = t < 0 ? nA : t > 1 ? nB : normal[s];
          const nx = n2[0];
          const ny = n2[1];
          const k = j * W + i;
          const dist = Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
          if (dist > reach || dist >= d[k]) continue;
          d[k] = dist;
          owner[k] = li;
          right[k] = (px - qx) * nx + (py - qy) * ny >= 0 ? 1 : 0;
          nx0[k] = qx;
          ny0[k] = qy;
        }
      }
    }
  });
  return { d, owner, right, qx: nx0, qy: ny0 };
}

/** A fade falling from 1 at `from` cells to 0 at `from + width`, eased. */
export function fallOff(d: number, from: number, width: number): number {
  return width > 0 ? 1 - ease(unit((d - from) / width)) : d <= from ? 1 : 0;
}

/** The ramps worked out lately, by what they were worked out from: a rebuild asks again for most of them unchanged. */
const kept = new Map<string, Ramp | null>();
const KEPT = 96;

/** FNV-1a over a string: a short key for a long one. */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

/** The ramp `build` works out from `inputs`, kept while the same inputs come back. */
export function keptRamp(kind: string, inputs: unknown, build: () => Ramp | null): Ramp | null {
  const key = `${kind}|${hashOf(JSON.stringify(inputs))}`;
  if (kept.has(key)) {
    const hit = kept.get(key)!;
    kept.delete(key);
    kept.set(key, hit);
    return hit;
  }
  const value = build();
  if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, value);
  return value;
}
