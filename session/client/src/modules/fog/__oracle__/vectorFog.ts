// The vector vision mask, kept as an oracle and nothing else.
//
// This is the pipeline the raster tier compositor replaced (docs/2026-09-01-raster-fog-mask-plan.md):
// Clipper offsets and booleans over the party's sweep, the region record's outline and the
// ground the player holds, answering which cells are live, which are a memory and which are
// void. Nothing ships it any more — `tierPlan` + `tierCompositor` answer the same question in
// primitive draws — but it is the only *independent* statement of that answer in the tree, and
// an A/B against an independent answer is worth more than any amount of self-consistency. So it
// lives on as `compositor-check`'s oracle: same inputs, same geometry, compared area for area,
// with the raster answer required to be a subset of this one (fog fails dark or it does not fail).
//
// Two rules keep it honest as a harness-only module:
//
//   1. **Nothing under `src/` outside the harness may import it.** Only `compositor-check.ts`
//      does, and only `compositor-check.html` reaches that, so Vite serves it in dev and it is
//      in no production bundle. A production import here is the failure mode to watch for — it
//      would put Clipper back on the drag path this phase took it off.
//   2. **It is not maintained against the shipped mask.** It is the *old* answer, deliberately.
//      When the two disagree the question is which is right, not which to edit.
//
// Simplified where the simplification cannot move the geometry: the four `memoOnce` slots the
// live path carried (P6 §1) are gone. They were a per-drag perf lever, and this runs a handful
// of scenes once — a memo here would only be a way for the oracle to answer a question it was
// not asked. `MASK_MAX_CELLS`, the record-size ceiling that dropped the painted tier back to
// row runs, is gone with them: the harness's records are small, and the fallback it guarded is
// exactly the staircase the raster tier exists to retire.

import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { toBytes, type RegionMask } from '@dnd/mechanics/fog';
import { regionRects, sightPad, type NightSight } from '../fog';

// ── The explored tier's silhouette, painted rather than tiled (W3) ───────────
// `regionRects` is honest geometry and the wrong shape for a wash: one axis-aligned rectangle
// per row run means every boundary the party's sweep actually draws — a circle, a diagonal —
// comes back as a staircase of one-cell steps. So the tier is painted first: the record's bits
// supersampled into an alpha field, blurred by half a cell, and cut at half strength. A blurred
// staircase's half-strength line is a smooth diagonal, which is the whole trick.

/**
 * Sub-samples per grid cell, per axis. The blur has to reach about a cell to round a one-cell
 * step, and a kernel that wide applied to the bits themselves drops a one-cell-thin run under
 * the cut level and erases it. Supersampling separates the two scales: two thirds of a cell in
 * the world, two samples in the field, so a lone swept cell paints to 0.6 while its neighbour
 * stays at 0. Two *fails* — a lone cell disappears — which is the floor this sits on.
 */
const MASK_SCALE = 3;

/** Two box passes of radius one, per axis: a ±2 sub-sample (±⅔ cell) triangle kernel. */
const BLUR_PASSES = 2;
const BLUR_RADIUS = 1;

/** Where the ring is cut. Half strength is the blurred staircase's own centreline. */
const MASK_LEVEL = 0.5;

/** A clear sub-sample margin, so the field is zero at its border and every ring closes. */
const PAD = BLUR_PASSES * BLUR_RADIUS + 2;

/** The painted field: alpha per sub-sample, and where sample (0, 0) sits in the world. */
interface MaskField {
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

/** The record's bits as a feathered alpha field, or null when there is nothing to paint. */
export function maskField(region: RegionMask | undefined): MaskField | null {
  if (!region || region.cols <= 0 || region.rows <= 0) return null;

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
 * Both saddles (one diagonal pair painted) are resolved on the cell's own average, so a pinch
 * the blur left connected stays connected.
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

// ── The mask itself ─────────────────────────────────────────────────────────

/**
 * A region's falloff limit in one Clipper call, where `fogRegion` takes three (P6 §1).
 *
 * Two identities do the work. Offsetting distributes over union — `(A ∪ B) ⊕ D` is
 * `(A ⊕ D) ∪ (B ⊕ D)` for a disc `D` — and every consumer below hands the result straight to a
 * Clipper boolean, which fills NonZero, where overlapping rings of one orientation are one
 * region. And offsetting composes — `(A ⊕ D_p) ⊕ D_f` is `A ⊕ D_{p+f}` — so a clear region and
 * its feather are one offset rather than two over already-offset geometry.
 */
const reachOf = (polys: readonly Polygon[], grow: number): Polygon[] =>
  polys.length > 0 ? clipper2Engine.inflate([...polys], grow) : [];

/** The explored tier's silhouette, and the cell count that used to ride beside it. */
function memoryOutline(region: RegionMask | undefined): Polygon[] {
  const field = maskField(region);
  return field ? maskRings(field) : regionRects(region);
}

/**
 * The contained-sight terms, dev-only and absent on every uncontained call — passing nothing
 * leaves this file byte-for-byte the pre-containment oracle.
 *
 * `shipped` above stays the *held* clip; on a contained scene the caller narrows it to the
 * ground the DM has opened and hands the rooms the seat was shipped over here instead.
 */
export interface Contained {
  /** One range-limited sweep per eye — the near pass. */
  near?: readonly Polygon[];
  /** Every room polygon the seat holds art for, or the frame on a roomless map. */
  shippedGround?: readonly Polygon[];
  /** The explore locks the seat knows about, subtracted from the near term alone. */
  locks?: readonly Polygon[];
}

/** What the vision mask draws. Void is everything neither tier covers. */
export interface VisionRegion {
  /** Live sight: the party's sweep union, out to the falloff's limit. Nothing is drawn here. */
  clear: Polygon[];
  /** The explored wash — swept cells and DM-revealed rooms, minus whatever is live. */
  memory: Polygon[];
  /** Both of them as one region, which is the hole the scrim cuts and the dots clip to. */
  shown: Polygon[];
}

/**
 * The vision mask's geometry, in one pass of Clipper.
 *
 * `revealed` is the rooms the DM has lit by hand, and they land in the *memory* tier rather than
 * the clear one on purpose: the party knows that layout because they were told, and their own
 * eyes are the only thing that makes anything live.
 *
 * `shipped` is every room the player actually holds geometry for and `painted` the ground the
 * map carries terrain paint on; *both* earned tiers are clipped to the two of them together. A
 * cell swept on bare unzoned map would otherwise put a wash over void that has nothing under it
 * to remember, and a sweep running past the last ground they hold would cut a bare-background
 * wedge out of the scrim — while painted ground between two floors is map with art on it, and
 * reveals like any other.
 *
 * Without Clipper2 loaded the intersections are empty, so the mask degrades to solid void —
 * dark rather than open, the direction a fog bug should fail in.
 */
export function visionRegion(
  sight: readonly Polygon[],
  region: RegionMask | undefined,
  revealed: readonly Polygon[],
  shipped: readonly Polygon[],
  pad: number,
  feather: number,
  night?: NightSight,
  painted: readonly Polygon[] = [],
  contained: Contained = {},
): VisionRegion {
  const rings = memoryOutline(region);
  const held = clipper2Engine.union([...reachOf(shipped, pad + feather), ...painted], []);
  const swept = reachOf(sight, sightPad(pad) + feather);
  const sweptFull =
    swept.length > 0 && held.length > 0 ? clipper2Engine.intersection(swept, held) : [];
  // The contained scene's second term, on the same pipeline: each eye's own range-limited
  // sweep, fenced to the ground whose art this seat holds and with the locks taken back out.
  // Dev-only, like the rest of this file — the product's answer is `tierPlan`'s, and this is
  // the independent statement it is measured against.
  const nearSwept = reachOf(contained.near ?? [], sightPad(pad) + feather);
  const shippedHeld = clipper2Engine.union(
    [...reachOf(contained.shippedGround ?? [], pad + feather), ...painted],
    [],
  );
  const nearShipped =
    nearSwept.length > 0 && shippedHeld.length > 0
      ? clipper2Engine.intersection(nearSwept, shippedHeld)
      : [];
  const lockReach = reachOf(contained.locks ?? [], sightPad(pad) + feather);
  const nearOpen =
    nearShipped.length > 0 && lockReach.length > 0
      ? clipper2Engine.difference(nearShipped, lockReach)
      : nearShipped;
  const sweptHeld =
    nearOpen.length > 0 ? clipper2Engine.union([...sweptFull, ...nearOpen], []) : sweptFull;
  // The light gate, as one more intersection on the same pipeline. A light's pool is padded
  // exactly as a sweep is, so a torch in a room lights the room's wall band rather than
  // stopping on the segments' centreline and leaving the stones dark.
  const litReach = night ? reachOf(night.lit, sightPad(pad) + feather) : [];
  const darkReach = night ? reachOf(night.darkvision, sightPad(pad) + feather) : [];
  const seeable = night ? clipper2Engine.union([...litReach, ...darkReach], []) : [];
  const clear = !night
    ? sweptHeld
    : sweptHeld.length > 0 && seeable.length > 0
      ? clipper2Engine.intersection(sweptHeld, seeable)
      : [];
  const revealedGrown = reachOf(revealed, pad + feather);
  const remembered = clipper2Engine.union([...rings, ...revealedGrown], []);
  const inside =
    remembered.length > 0 && held.length > 0
      ? clipper2Engine.intersection(remembered, held)
      : [];
  const memory = clear.length > 0 ? clipper2Engine.difference(inside, clear) : inside;
  return {
    clear,
    memory,
    // Unioned rather than kept as two: the feather runs round the outside of everything the
    // party holds, and a rim between a lit sweep and its own memory would be a line drawn where
    // the light is still on.
    shown: clipper2Engine.union([...clear, ...memory], []),
  };
}
