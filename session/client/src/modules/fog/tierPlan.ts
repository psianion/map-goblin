// The vision mask as a *description* of draws, computed without a GPU and without Clipper.
//
// This is the pure half of the tier compositor (docs/2026-09-01-raster-fog-mask-plan.md). It
// answers exactly the question `visionRegion` answers today — which ground is live, which is a
// memory, and which is void — but it answers it as a list of primitive draw ops rather than as
// polygon booleans, because every boolean in that pipeline exists only to be rasterised a
// moment later. A fill plus a round-joined stroke of width `2r` *is* the Minkowski inflate
// Clipper was paying for (P0: 0.003% area error), and an intersection is an erase of the
// complement (P0: `multiply` is unreliable into a RenderTexture on 8.17, `erase` is not).
//
// Everything that used to be a *rule* buried in `visionRegion` and `drawFog` is stated here,
// where a test with no GL can read it back off the plan:
//
//   1. A clip is in every pass that touches live sight, and one is always the last word on the
//      mask. Uncontained, that clip is `held`, and its sources are the pre-containment
//      statement — the rooms the player was shipped, the ground the map carries paint on, and
//      on a map nobody zoned the region record's own cell runs. That last one is the loud
//      trap: a battlemap has no walls, so a sweep's rays run `SIGHT_REACH` out past every
//      edge, and the record is the only thing that stops them.
//      Contained, `held` narrows to the ground the DM has actually opened and the last word
//      passes to the *shipping* clip, which is what lets a step peel the cloud back without
//      ever clearing fog off ground whose art this seat was never sent.
//   2. The cover is measured off the frame and the held sources, never off a sweep vertex —
//      `drawFog`'s own county-mask comment, moved somewhere it can be pinned.
//   3. Rooms the DM revealed land in the memory tier. Told is not the same as looked at.
//   4. The night gate exists only when the scene passed one; daylight is the whole sweep.
//   5. The record's bits become texture bytes one for one — one texel per cell, no geometry,
//      no `MASK_MAX_CELLS` ceiling.
//
// No Pixi in here. `tierCompositor.ts` is the executor and holds every Pixi object.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { toBytes, type RegionMask } from '@dnd/mechanics/fog';
import type { Bounds } from './FogRenderer';
import { regionCells, regionRects, sightPad, type NightSight } from './fog';

/**
 * The mask's live tier. White, as it has always been.
 *
 * Stated here rather than imported so this module keeps its promise of pulling in no Pixi —
 * `livingFog.ts` owns the shader and imports the renderer. `tierPlan.test.ts` pins the two
 * against each other, which is the only place the equality actually has to hold.
 */
export const MASK_LIVE = 0xffffff;

/** …and the memory tier — must equal `livingFog`'s `MASK_MEMORY`. Pinned in the test. */
export const MASK_MEMORY_GREY = 0x808080;

/**
 * Extra softening on the memory tier, in cells — and it is deliberately zero.
 *
 * The retired `memoryMask` pass spent a supersample-and-blur to turn the record's staircase
 * into a smooth diagonal: three sub-samples per cell, two box passes of radius one, cut at half
 * strength (σ ≈ 0.385 cell). A one-texel-per-cell texture drawn through a *linear* sampler
 * already is that kernel — bilinear interpolation over the cell lattice is a two-cell tent, σ ≈ 0.41
 * cell, and its half-level line lands on the same cell boundary the box blur's did. Measured
 * on a 45° staircase in `compositor-check`: the field along the boundary line stays within
 * 0.44–0.56 where the raw record alternates 0–1.
 *
 * A second blur on top of that is not free and not neutral: blurring in 2-D costs a *lone*
 * swept cell its level (a ⅔-cell Gaussian takes its peak to ~0.65, which the cloud then reads
 * as two fifths of the way back to hidden), and a lone cell disappearing is the exact failure
 * that pass's three sub-samples were chosen against. So the sampler is the kernel and this stays 0; the
 * field is here as a knob because the plan is where a knob like this belongs.
 */
export const MEMORY_BLUR_CELLS = 0;

/** The two native blends P0 proved into a RenderTexture on 8.17. Nothing else is allowed. */
export type Blend = 'normal' | 'erase';

/**
 * The render targets a plan draws into, in the order they must be executed — a target may
 * only ever sample one that comes before it.
 *
 * - `inverseHeld`: white over the whole cover with the held sources erased out of it. The
 *   clip, as its erase-dual: erasing this from anything leaves that thing inside held.
 * - `inverseShipped`: the same trick for the *shipping* clip, built only on a contained
 *   scene — the ground whose art this seat actually holds, less the lock zones it knows
 *   about. The near pass may open ground outside `held`, and this is the fence that keeps it
 *   from opening ground with no art under it (an empty hole is a shape leak).
 * - `inverseSeeable`: the same trick for the night gate — light and darkvision erased out.
 * - `live`: the party's own sweep, gated by the night if there is one.
 * - `mask`: the tier texture the cloud shader samples. Clears *transparent*, so alpha carries
 *   shown-ness and an erased texel reads 0 in `.r` either way.
 * - `scrim`: the flat black backstop, with the mask's own alpha erased out of it.
 */
export type TierTarget =
  | 'inverseHeld'
  | 'inverseShipped'
  | 'inverseSeeable'
  | 'live'
  | 'mask'
  | 'scrim';

export const TARGET_ORDER: readonly TierTarget[] = [
  'inverseHeld',
  'inverseShipped',
  'inverseSeeable',
  'live',
  'mask',
  'scrim',
];

/**
 * The region record as texture bytes: one RGBA texel per cell, opaque white where the bit is
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
   * polygon ⊕ disc(grow) the Clipper offset used to buy.
   */
  | {
      kind: 'polys';
      target: TierTarget;
      polys: readonly Polygon[];
      grow: number;
      color: number;
      blend: Blend;
    }
  /** The record's cells, linearly upscaled and tinted to the memory grey. */
  | {
      kind: 'cells';
      target: TierTarget;
      cells: CellTexture;
      blurCells: number;
      color: number;
      blend: Blend;
    }
  /** One target composited into another over the whole cover. */
  | { kind: 'sprite'; target: TierTarget; source: TierTarget; blend: Blend };

export interface DrawPlan {
  /**
   * The world rect every target covers — frame ∪ held, grown by pad + feather. Null is "this
   * seat holds nothing anywhere": no target is sized, nothing is composited, and the caller
   * draws no cover at all (`drawFog`'s null return, unchanged).
   */
  cover: Bounds | null;
  ops: readonly DrawOp[];
  /** The record's own bit count — `__fogProbe.memoryCells`, unchanged. */
  cells: number;
}

/** What the compositor needs to know about a seat's fog. `visionTiers`'s arguments, as data. */
export interface TierScene {
  /** One raw sweep polygon per sighted party token. Never sizes anything. */
  sight: readonly Polygon[];
  /**
   * Contained sight (`containedSightOn` on a vision scene) — the fence, and the one switch
   * this whole composition hangs off. False reproduces the pre-containment plan exactly,
   * op for op, and a regression row pins that.
   */
  contained: boolean;
  /**
   * The range-limited twin of `sight`: one sweep per eye taken at that eye's own
   * `sight.range` rather than at `SIGHT_REACH`. Read only when `contained`.
   *
   * One polygon per eye and never a union, because the rule is per-eye: ground near a
   * short-sighted eye but outside its line of sight is not opened by a far-sighted one
   * standing elsewhere.
   */
  near?: readonly Polygon[];
  /**
   * The auto-explore lock zones (`blocksAutoExplore`) this seat *knows about*, subtracted
   * from the near pass so an eye at a locked chamber's open mouth cannot peel it by range.
   *
   * In practice this is the DM's sight preview only: zones are prep and the redaction strips
   * them from every player's copy unconditionally (server `redactMap.ts`, "prep never
   * travels"). A player's near pass is fenced by `inverseShipped` instead, which on a walled
   * map already excludes a locked room — one is never credited, so its geometry never ships.
   * A roomless map ships whole, so a lock zone there is the one case the client cannot see;
   * the referee still refuses to write those cells, so the divergence is a client that shows
   * a cell for one state update, and never a client that keeps one the referee took back.
   */
  locks?: readonly Polygon[];
  /** The referee's region record for this seat — the memory tier, and on a roomless map the clip. */
  region?: RegionMask;
  /** Every room boundary the player was actually handed. */
  rooms: readonly Polygon[];
  /** …and the ones the DM lit by hand, which are a memory and never live. */
  revealed: readonly Polygon[];
  /** Ground the map carries terrain paint on (`paintedGround`) — opens the clip, reveals nothing. */
  painted?: readonly Polygon[];
  /** `fogPad` — how far past its floor a room's claim reaches. */
  pad: number;
  /** `FOG_FEATHER` — how far past that the falloff runs. */
  feather: number;
  /** Present only on a `darkness` scene: the light gate on live sight. */
  night?: NightSight;
  /** The map frame the cover starts from (`FogScene.bounds`). Null ⇒ nothing is drawn. */
  frame: Bounds | null;
}

const usable = (polys: readonly Polygon[]): Polygon[] => polys.filter((p) => p.length >= 3);

/**
 * The ground a memory or a sweep is allowed to sit on — `heldGround`, moved here.
 *
 * A map nobody zoned has no room polygons, and the record itself is then the only honest
 * answer: "ground the player holds" is "ground the referee has shown them". The map's frame is
 * the other obvious answer and is the bug — an unoccluded sweep opens the whole battlemap on
 * the first frame a player connects.
 *
 * Contained sight moves the same question one step: the fence is no longer "every room you
 * were handed" but "the ground the DM has actually opened" — the record's runs plus the rooms
 * the DM revealed by hand. A room you hold the geometry of but nobody has opened is layout you
 * were told about, and telling is not opening. That is the whole feature, in one ternary.
 */
const heldSources = (
  contained: boolean,
  rooms: readonly Polygon[],
  revealed: readonly Polygon[],
  region: RegionMask | undefined,
): Polygon[] =>
  contained
    ? [...revealed, ...regionRects(region)]
    : rooms.length > 0
      ? [...rooms]
      : regionRects(region);

const asPoly = (b: Bounds): Polygon => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];

/**
 * The ground whose *art* this seat holds — the near pass's own fence, and only ever consulted
 * on a contained scene.
 *
 * Every room polygon that reached this seat, held ground included. That deliberately covers
 * rooms the player has not earned yet: the band buy-back ships a revealed room's neighbours,
 * and the inside of a door you can see through is exactly the ground a step is supposed to
 * open. A roomless map ships its image whole (#114), so there the answer is the frame and the
 * near pass is bounded by range alone.
 */
const shippedGround = (
  rooms: readonly Polygon[],
  held: readonly Polygon[],
  frame: Bounds | null,
): Polygon[] =>
  rooms.length > 0 ? [...rooms, ...held] : frame ? [asPoly(frame)] : [];

/**
 * Frame ∪ held, grown by the pad and the feather — and nothing else, ever.
 *
 * A sweep reaches the whole map by line of sight and its rays run a thousand cells out before
 * anything clips them; growing the cover to those put the map in the corner of a mask the size
 * of a county. Painted ground contributes its own bounds ungrown, because that is how it
 * enters the clip (`held` unions the *padded* rooms with the paint as it stands).
 */
function coverOf(
  frame: Bounds | null,
  held: readonly Polygon[],
  painted: readonly Polygon[],
  grow: number,
): Bounds | null {
  if (!frame) return null;
  let minX = frame.minX - grow;
  let minY = frame.minY - grow;
  let maxX = frame.maxX + grow;
  let maxY = frame.maxY + grow;
  const take = (polys: readonly Polygon[], pad: number): void => {
    for (const poly of polys) {
      for (const [x, y] of poly) {
        minX = Math.min(minX, x - pad);
        minY = Math.min(minY, y - pad);
        maxX = Math.max(maxX, x + pad);
        maxY = Math.max(maxY, y + pad);
      }
    }
  };
  take(held, grow);
  take(painted, 0);
  return { minX, minY, maxX, maxY };
}

/**
 * The record's bits, one RGBA texel per cell. Null when there is no record or nothing set in
 * it — an empty memory tier is no draw at all rather than a transparent one.
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
 * The whole vision mask, as draws.
 *
 * Order is the semantics here, exactly as draw order was in `drawFog`: the memory grey goes
 * down first and live white lands over it, which on a vocabulary of `normal` and `erase` is
 * the `max` the two tiers want. The clip comes last on the mask so nothing can be added after
 * it, and the scrim is one erase of the finished mask so the two layers cannot disagree about
 * where a hole is.
 */
export function tierPlan(scene: TierScene): DrawPlan {
  const grow = scene.pad + scene.feather;
  const sweepGrow = sightPad(scene.pad) + scene.feather;
  const rooms = usable(scene.rooms);
  const painted = usable(scene.painted ?? []);
  const revealed = usable(scene.revealed);
  const contained = scene.contained;
  const held = heldSources(contained, rooms, revealed, scene.region);
  const shipped = contained ? shippedGround(rooms, held, scene.frame) : [];
  const cover = coverOf(scene.frame, contained ? [...shipped, ...held] : held, painted, grow);
  const cells = regionCells(scene.region);
  if (!cover) return { cover: null, ops: [], cells };

  const sight = usable(scene.sight);
  // The near pass and its lock subtraction exist only under containment — off, not one op of
  // either is emitted and the plan is the pre-containment one byte for byte.
  const near = contained ? usable(scene.near ?? []) : [];
  const locks = contained ? usable(scene.locks ?? []) : [];
  const night = scene.night;
  const seeable = night ? usable([...night.lit, ...night.darkvision]) : [];
  const memory = cellTexture(scene.region);
  const ops: DrawOp[] = [];

  // ── The clip, as its erase-dual ────────────────────────────────────────────
  // White everywhere, then the held sources taken back out: what is left is exactly the
  // complement of held, and erasing it from a tier is the intersection P0 forbade `multiply`
  // from performing. Fails in the right direction on its own — a pass that never ran leaves
  // the cover white, which erases the whole mask to hidden.
  ops.push({ kind: 'rect', target: 'inverseHeld', rect: cover, color: MASK_LIVE, blend: 'normal' });
  if (held.length > 0) {
    ops.push({ kind: 'polys', target: 'inverseHeld', polys: held, grow, color: MASK_LIVE, blend: 'erase' });
  }
  if (painted.length > 0) {
    ops.push({ kind: 'polys', target: 'inverseHeld', polys: painted, grow: 0, color: MASK_LIVE, blend: 'erase' });
  }

  // ── The shipping clip, on the same trick ──────────────────────────────────
  // Contained scenes only, and built whether or not there is a near pass to fence, because it
  // is also the mask's last word there: an unbuilt target is a full white cover, which erases
  // the mask to hidden rather than leaving a hole. The locks go back in as white *after* the
  // shipped ground comes out, so a lock inside a shipped room is fenced off again.
  if (contained) {
    ops.push({ kind: 'rect', target: 'inverseShipped', rect: cover, color: MASK_LIVE, blend: 'normal' });
    if (shipped.length > 0) {
      ops.push({ kind: 'polys', target: 'inverseShipped', polys: shipped, grow, color: MASK_LIVE, blend: 'erase' });
    }
    if (painted.length > 0) {
      ops.push({ kind: 'polys', target: 'inverseShipped', polys: painted, grow: 0, color: MASK_LIVE, blend: 'erase' });
    }
    if (locks.length > 0) {
      // Grown by the same `sweepGrow` the near sweeps are, which cancels their inflate exactly
      // and leaves the authored zone as the fence. Erring the other way would hand a sweep the
      // first band of a locked chamber, which is the leak the zone was drawn to stop.
      ops.push({ kind: 'polys', target: 'inverseShipped', polys: locks, grow: sweepGrow, color: MASK_LIVE, blend: 'normal' });
    }
  }

  // ── The night gate, on the same trick ──────────────────────────────────────
  // Present only when the scene handed one over: daylight and dusk count the whole sweep as
  // lit, which is the mask this had before the dial existed.
  if (night && sight.length > 0) {
    ops.push({
      kind: 'rect',
      target: 'inverseSeeable',
      rect: cover,
      color: MASK_LIVE,
      blend: 'normal',
    });
    if (seeable.length > 0) {
      ops.push({
        kind: 'polys',
        target: 'inverseSeeable',
        polys: seeable,
        grow: sweepGrow,
        color: MASK_LIVE,
        blend: 'erase',
      });
    }
  }

  // ── Live sight ─────────────────────────────────────────────────────────────
  // Its own target rather than straight into the mask, because the night gate applies to this
  // tier alone: what a torch does not reach is still remembered, it is only not current.
  if (sight.length > 0) {
    ops.push({
      kind: 'polys',
      target: 'live',
      polys: sight,
      grow: sweepGrow,
      color: MASK_LIVE,
      blend: 'normal',
    });
    // The held clip, on this target as well as on the mask — because `live` is not only a
    // tier. It is also the stencil the token chips and the turn ring wear (`SIGHT_MASK`),
    // and that layer never passes through the mask's own clip: an unclipped sweep here is a
    // chip drawn on ground the seat does not hold, which on a roomless map is every ray's
    // full `SIGHT_REACH`. Erases commute, so the night gate below is still the last word.
    ops.push({ kind: 'sprite', target: 'live', source: 'inverseHeld', blend: 'erase' });
    // ── The near pass ────────────────────────────────────────────────────────
    // `live = (full ∩ held) ∪ (near ∩ shipped ∖ locks)`. The union has to land *after* the
    // held clip, because held is precisely what the near term is allowed to reach past — that
    // is what "movement peels the cloud back" means. The held clip is therefore no longer the
    // last op on this target under containment; `inverseShipped` is, and it is the tighter
    // statement of the same invariant (held ⊆ shipped, and held carries no locked ground by
    // construction, so the full term is untouched by the second erase). The `SIGHT_MASK`
    // argument survives intact: a chip still cannot be drawn past a clip.
    if (near.length > 0) {
      ops.push({ kind: 'polys', target: 'live', polys: near, grow: sweepGrow, color: MASK_LIVE, blend: 'normal' });
    }
    if (contained) ops.push({ kind: 'sprite', target: 'live', source: 'inverseShipped', blend: 'erase' });
    if (night) ops.push({ kind: 'sprite', target: 'live', source: 'inverseSeeable', blend: 'erase' });
  }

  // ── The mask: memory under, live over, the clip last ──────────────────────
  if (memory) {
    ops.push({
      kind: 'cells',
      target: 'mask',
      cells: memory,
      blurCells: MEMORY_BLUR_CELLS,
      color: MASK_MEMORY_GREY,
      blend: 'normal',
    });
  }
  if (revealed.length > 0) {
    ops.push({
      kind: 'polys',
      target: 'mask',
      polys: revealed,
      grow,
      color: MASK_MEMORY_GREY,
      blend: 'normal',
    });
  }
  if (sight.length > 0) ops.push({ kind: 'sprite', target: 'mask', source: 'live', blend: 'normal' });
  // The clip, last, so nothing can be added after it — and under containment it is the
  // shipping clip rather than the held one, for the reason the near pass gives: erasing
  // `inverseHeld` here would take back every cell the near pass just earned. Memory and
  // DM-revealed rooms sit inside held ⊆ shipped, so they are unmoved by the swap.
  ops.push({
    kind: 'sprite',
    target: 'mask',
    source: contained ? 'inverseShipped' : 'inverseHeld',
    blend: 'erase',
  });

  // ── The scrim ─────────────────────────────────────────────────────────────
  // Opaque black by initialisation with the finished mask's own alpha punched out of it. The
  // fail-dark argument, unchanged in shape: any pass that does not run leaves it opaque.
  ops.push({ kind: 'rect', target: 'scrim', rect: cover, color: 0x000000, blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' });

  return { cover, ops, cells };
}
