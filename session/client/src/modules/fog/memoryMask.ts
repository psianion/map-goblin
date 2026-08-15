// W3 — the explored tier's silhouette, painted rather than tiled.
//
// `regionRects` is honest geometry and the wrong shape for a wash: one axis-aligned rectangle
// per row run means every boundary the party's sweep actually draws — a circle, a diagonal —
// comes back as a staircase of one-cell steps, and the fog's own feather then ramps *along*
// that staircase. Beside P2's soft light pools the steps are what the eye lands on.
//
// So the tier is painted first: the record's bits supersampled into an offscreen alpha field,
// blurred by half a cell, and cut at half strength. The rings the mask is then built from are
// that field's isocontour, and a blurred staircase's half-strength line is a smooth diagonal —
// which is the whole trick. Nothing downstream changes shape: the wash, the hole cut in the
// void and the falloff stroked round it all follow one soft outline instead of the tiling.
//
// It costs one paint per region delta and nothing per frame. `visionRegion` memoizes this on
// the record's own bytes (`memoryMask`), so a token dragged across the map rebuilds the sweep
// on every write and repaints this on none of them.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { toBytes, type RegionMask } from '@dnd/mechanics/fog';

/**
 * Sub-samples per grid cell, per axis — and the one number here that is not a preference.
 *
 * The blur below has to reach about a cell to round a one-cell step, and a normalised blur
 * that wide, applied to the bits themselves, drops a one-cell-thin *run* under the cut level
 * and erases it — the corridor the party swept would leave their memory to fix its edges.
 * Supersampling is what separates the two scales: the kernel stays two thirds of a cell wide
 * in the world and two samples wide in the field, so a lone swept cell paints to 0.6 while
 * the cell beside it stays at 0.
 *
 * Three rather than four is measured, not rounded down: at both, the isocontour of a 45°
 * staircase comes back within 5% of the true hypotenuse (41.9 and 44.4 against 42.4 for a
 * clean diagonal and 60 for the steps), and three costs a little over half as much. Two
 * *fails* — a lone cell disappears — which is the floor this is sitting on.
 */
export const MASK_SCALE = 3;

/** Two box passes of radius one, per axis: a ±2 sub-sample (±⅔ cell) triangle kernel. */
const BLUR_PASSES = 2;
const BLUR_RADIUS = 1;

/** Where the ring is cut. Half strength is the blurred staircase's own centreline. */
export const MASK_LEVEL = 0.5;

/** A clear sub-sample margin, so the field is zero at its border and every ring closes. */
const PAD = BLUR_PASSES * BLUR_RADIUS + 2;

/**
 * Past this the paint is skipped and the caller keeps the row runs.
 *
 * ponytail: a ceiling, not a tuning. The paint is linear in the frame's cells — the repo's
 * biggest demo map (Fieldstone Keep) is ~3k and pays under 2ms, and this cap is ~180×180,
 * about 17ms in jsdom, still the same order as the Clipper pass beside it. A frame larger
 * than that keeps today's stair-stepped tier rather than putting a hitch on every sweep
 * delta; the upgrade the day such a map exists is painting into a canvas on the GPU, not a
 * bigger number here.
 */
export const MASK_MAX_CELLS = 32768;

/** The painted field: alpha per sub-sample, and where sample (0, 0) sits in the world. */
export interface MaskField {
  alpha: Float32Array;
  cols: number;
  rows: number;
  /** Sample (c, r) is the world point (originX + c · step, originY + r · step). */
  originX: number;
  originY: number;
  step: number;
}

/** One box pass along the rows, zero outside — the padding guarantees nothing is clipped. */
function blurRows(src: Float32Array, dst: Float32Array, cols: number, rows: number): void {
  const width = BLUR_RADIUS * 2 + 1;
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k++) {
        const x = c + k;
        if (x >= 0 && x < cols) sum += src[o + x];
      }
      dst[o + c] = sum / width;
    }
  }
}

/** …and one along the columns. Separable, so the two together are the 2-D kernel. */
function blurCols(src: Float32Array, dst: Float32Array, cols: number, rows: number): void {
  const width = BLUR_RADIUS * 2 + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k++) {
        const y = r + k;
        if (y >= 0 && y < rows) sum += src[y * cols + c];
      }
      dst[r * cols + c] = sum / width;
    }
  }
}

/**
 * The record's bits as a feathered alpha field, or null when there is nothing to paint (no
 * record, an empty frame, or one past {@link MASK_MAX_CELLS}).
 */
export function maskField(region: RegionMask | undefined): MaskField | null {
  if (!region || region.cols <= 0 || region.rows <= 0) return null;
  if (region.cols * region.rows > MASK_MAX_CELLS) return null;

  const cols = region.cols * MASK_SCALE + PAD * 2;
  const rows = region.rows * MASK_SCALE + PAD * 2;
  const bytes = toBytes(region.bits);
  const alpha = new Float32Array(cols * rows);
  for (let row = 0; row < region.rows; row++) {
    for (let col = 0; col < region.cols; col++) {
      const bit = row * region.cols + col;
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue;
      const x0 = PAD + col * MASK_SCALE;
      for (let sr = 0; sr < MASK_SCALE; sr++) {
        const o = (PAD + row * MASK_SCALE + sr) * cols;
        alpha.fill(1, o + x0, o + x0 + MASK_SCALE);
      }
    }
  }

  // One scratch buffer, written and read back in turn: the field ends up in `alpha` either way.
  const scratch = new Float32Array(alpha.length);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    blurRows(alpha, scratch, cols, rows);
    blurCols(scratch, alpha, cols, rows);
  }

  return {
    alpha,
    cols,
    rows,
    originX: region.minX + (0.5 - PAD) / MASK_SCALE,
    originY: region.minY + (0.5 - PAD) / MASK_SCALE,
    step: 1 / MASK_SCALE,
  };
}

type Pt = [number, number];

/**
 * The field's isocontour, as closed rings — marching squares over the sample lattice with the
 * crossing point interpolated along each edge, which is where the sub-cell smoothness comes
 * from (a threshold alone would hand back a staircase at four times the resolution).
 *
 * Segments are emitted with the painted side on the right and each finished ring is reversed,
 * so an outline winds positive and a hole inside it winds negative — the orientation
 * `regionRects` hands Clipper, which unions these under the same non-zero fill.
 *
 * Both saddles (one diagonal pair painted) are resolved on the cell's own average, so a
 * pinch the blur left connected stays connected.
 */
export function maskRings(field: MaskField, level = MASK_LEVEL): Polygon[] {
  const { alpha, cols, rows, originX, originY, step } = field;
  const segs: [Pt, Pt][] = [];
  const cross = (v0: number, v1: number): number => {
    const d = v1 - v0;
    return d === 0 ? 0.5 : Math.min(1, Math.max(0, (level - v0) / d));
  };

  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const i = r * cols + c;
      const v0 = alpha[i];
      const v1 = alpha[i + 1];
      const v2 = alpha[i + cols + 1];
      const v3 = alpha[i + cols];
      const code =
        (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top: Pt = [c + cross(v0, v1), r];
      const right: Pt = [c + 1, r + cross(v1, v2)];
      const bottom: Pt = [c + cross(v3, v2), r + 1];
      const left: Pt = [c, r + cross(v0, v3)];
      const joined = (v0 + v1 + v2 + v3) / 4 > level;
      switch (code) {
        case 1: segs.push([left, top]); break;
        case 2: segs.push([top, right]); break;
        case 3: segs.push([left, right]); break;
        case 4: segs.push([right, bottom]); break;
        case 5:
          if (joined) segs.push([left, bottom], [right, top]);
          else segs.push([left, top], [right, bottom]);
          break;
        case 6: segs.push([top, bottom]); break;
        case 7: segs.push([left, bottom]); break;
        case 8: segs.push([bottom, left]); break;
        case 9: segs.push([bottom, top]); break;
        case 10:
          if (joined) segs.push([top, left], [bottom, right]);
          else segs.push([top, right], [bottom, left]);
          break;
        case 11: segs.push([bottom, right]); break;
        case 12: segs.push([right, left]); break;
        case 13: segs.push([right, top]); break;
        default: segs.push([top, left]); break;
      }
    }
  }

  // Chained on the endpoints themselves: two neighbouring cells interpolate a shared edge from
  // the same two samples with the same arithmetic, so the crossing they each compute is the
  // same float and the key matches exactly.
  const key = (p: Pt): string => `${p[0]},${p[1]}`;
  const from = new Map<string, number[]>();
  segs.forEach((seg, i) => {
    const k = key(seg[0]);
    const at = from.get(k);
    if (at) at.push(i);
    else from.set(k, [i]);
  });

  const used = new Uint8Array(segs.length);
  const rings: Polygon[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const ring: Polygon = [];
    let cur = i;
    while (!used[cur]) {
      used[cur] = 1;
      ring.push([originX + segs[cur][0][0] * step, originY + segs[cur][0][1] * step]);
      const next = from.get(key(segs[cur][1]))?.find((j) => !used[j]);
      if (next === undefined) break;
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring.reverse());
  }
  return rings;
}

/** How many cells the record actually holds — what `__fogProbe.memoryCells` reports. */
export function regionCells(region: RegionMask | undefined): number {
  if (!region) return 0;
  const bytes = toBytes(region.bits);
  let n = 0;
  for (let bit = 0; bit < region.cols * region.rows; bit++) {
    if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) n++;
  }
  return n;
}
