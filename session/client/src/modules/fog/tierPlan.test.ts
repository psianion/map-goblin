// The vision mask's contracts, re-pinned against the *plan* instead of against Clipper output.
//
// Every row here is the plan-level twin of a `visionRegion`/`drawFog` row in
// `FogRenderer.test.ts`, and each is written so a plausible mistake in the builder changes the
// answer: the clip's source on a roomless map, the cover's sources, which tier a DM-revealed
// room lands in, whether the night gate exists at all, and the record's bits reaching the
// texture one for one. No GPU and no Clipper — the whole point of splitting the compositor in
// two is that this half needs neither.

import { describe, expect, it } from 'vitest';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { regionOf, setCells } from '@dnd/mechanics/fog';
import { FOG_FEATHER } from './FogRenderer';
import { fogPad, openGroundParts, regionCells, regionRects, sightPad, type NightSight } from './fog';
import { MASK_MEMORY } from './livingFog';
import {
  MASK_LIVE,
  MASK_MEMORY_GREY,
  MEMORY_BLUR_CELLS,
  EDGE_FEATHER_CELLS,
  FRAME_SHADOW_CELLS,
  FRAME_SHADOW_DEPTH,
  blurPasses,
  cellTexture,
  edgeFeather,
  frameShadow,
  onMapSample,
  outsideFrame,
  tierPlan,
  type DrawOp,
  type DrawPlan,
  type TierScene,
  type TierTarget,
} from './tierPlan';

const PAD = fogPad([]);
const GROW = PAD + FOG_FEATHER;
const SWEEP_GROW = sightPad(PAD) + FOG_FEATHER;

/** The two-hall fixture `FogRenderer.test.ts` fogs, one 0.5-wide wall between the floors. */
const hall = (x0: number, x1: number): Polygon => [
  [x0, 0],
  [x1, 0],
  [x1, 6],
  [x0, 6],
];
const WEST = hall(4, 9.75);
const EAST = hall(10.25, 16);
const FRAME = { minX: 0, minY: 0, maxX: 24, maxY: 8 };

/** A stretch of the west hall's upper half, as a sweep comes off the shadowcast. */
const LOOKING: Polygon = [
  [6, 0.5],
  [8, 0.5],
  [8, 2],
  [6, 2],
];

/**
 * The battlemap sweep: no walls, so nothing occludes it and its rays run `SIGHT_REACH` out
 * past every edge of the map. This is what the party's sight actually looks like there.
 */
const UNOCCLUDED: Polygon = [
  [-100, -100],
  [124, -100],
  [124, 108],
  [-100, 108],
];

const brushed = (cells: [number, number][]) => setCells(regionOf(FRAME)!, cells);

/**
 * The uncontained scene — every row below it that does not say otherwise is the
 * pre-containment mask, and that is deliberate rather than incidental.
 *
 * `containedSight` defaults *on* in the rules (`containedSightOn`), so leaving it out here
 * would have quietly re-aimed a dozen rows written about the old composition at the new one.
 * Each of them is pinned where it was and the contained twin is written beside it, so the
 * switch has both of its positions held down by a test rather than one.
 */
const scene = (over: Partial<TierScene> = {}): TierScene => ({
  sight: [],
  contained: false,
  rooms: [WEST, EAST],
  revealed: [],
  pad: PAD,
  feather: FOG_FEATHER,
  frame: FRAME,
  ...over,
});

/** …and its contained twin. */
const fenced = (over: Partial<TierScene> = {}): TierScene => scene({ contained: true, ...over });

const opsOn = (plan: DrawPlan, target: TierTarget): DrawOp[] =>
  plan.ops.filter((op) => op.target === target);

type PolyOp = Extract<DrawOp, { kind: 'polys' }>;
const polysOn = (plan: DrawPlan, target: TierTarget): PolyOp[] =>
  opsOn(plan, target).filter((op): op is PolyOp => op.kind === 'polys');

describe('tierPlan — the tier colours the cloud shader reads', () => {
  it('paints the memory tier at exactly the grey the shader ramps on', () => {
    // `tierPlan` states these itself so it can stay free of Pixi; this is where the two have
    // to agree, and a drift either way puts the memory tier on the wrong side of a ramp.
    expect(MASK_MEMORY_GREY).toBe(MASK_MEMORY);
    expect(MASK_LIVE).toBe(0xffffff);
  });

  it('leaves the memory smoothing to the sampler', () => {
    // The linear upscale of a one-texel-per-cell texture *is* `memoryMask`'s ⅔-cell kernel;
    // a second blur on top of it is what costs a lone swept cell its level.
    expect(MEMORY_BLUR_CELLS).toBe(0);
  });
});

describe('tierPlan — the held clip', () => {
  it('is the last word on the mask, after everything live', () => {
    const plan = tierPlan(scene({ sight: [LOOKING] }));
    const mask = opsOn(plan, 'mask');
    const last = mask[mask.length - 1];
    expect(last).toMatchObject({ kind: 'sprite', source: 'inverseHeld', blend: 'erase' });
    // …and live is genuinely under it, which is the whole reason the clip is last: a sweep
    // composited after the clip is a sweep nothing stops.
    const live = mask.findIndex((op) => op.kind === 'sprite' && op.source === 'live');
    expect(live).toBeGreaterThanOrEqual(0);
    expect(live).toBeLessThan(mask.length - 1);
  });

  it('clips a seat that is looking at nothing at all, too', () => {
    // Fail-dark: no sweep and no record still composites the clip, so a mask left over from
    // the previous rebuild cannot survive as a hole.
    const plan = tierPlan(scene());
    expect(opsOn(plan, 'mask')).toEqual([
      { kind: 'sprite', target: 'mask', source: 'inverseHeld', blend: 'erase' },
    ]);
  });

  it('builds the complement as a full-cover fill with the held sources erased out', () => {
    const plan = tierPlan(scene({ sight: [LOOKING] }));
    const inverse = opsOn(plan, 'inverseHeld');
    expect(inverse[0]).toMatchObject({ kind: 'rect', rect: plan.cover, blend: 'normal' });
    expect(inverse[1]).toMatchObject({ kind: 'polys', polys: [WEST, EAST], grow: GROW, blend: 'erase' });
    // No `multiply` anywhere, on any target — P0 measured it unreliable into a RenderTexture.
    expect(plan.ops.every((op) => op.blend === 'normal' || op.blend === 'erase')).toBe(true);
  });

  it('holds a map nobody zoned to the cell runs in the record, not to its frame', () => {
    // The regression this whole clip exists for. A battlemap has no rooms, so the record is
    // the only honest statement of "ground the player holds"; clipped to the frame instead,
    // the unoccluded sweep opens the entire map on the first frame a player connects.
    const region = brushed([
      [6, 0],
      [7, 0],
      [6, 1],
      [7, 1],
    ]);
    const plan = tierPlan(scene({ rooms: [], region, sight: [UNOCCLUDED] }));
    const [erase] = polysOn(plan, 'inverseHeld');
    expect(erase).toMatchObject({ grow: GROW, blend: 'erase' });
    expect(erase.polys).toEqual(regionRects(region));

    // …and the same scene with rooms handed over clips to the rooms instead, which is the
    // mutation that tells the two branches apart.
    const zoned = tierPlan(scene({ region, sight: [UNOCCLUDED] }));
    expect(polysOn(zoned, 'inverseHeld')[0].polys).toEqual([WEST, EAST]);
  });

  it('clips the live target too, because that one is also the token stencil', () => {
    // `live` is what the chip and turn-ring layers wear as `SIGHT_MASK`, and that layer never
    // passes through the mask's clip. Unclipped here, a chip is drawn wherever a ray reached
    // — on a roomless map, `SIGHT_REACH` past every edge of the record.
    const plan = tierPlan(scene({ rooms: [], region: brushed([[6, 0]]), sight: [UNOCCLUDED] }));
    expect(opsOn(plan, 'live')).toContainEqual({
      kind: 'sprite',
      target: 'live',
      source: 'inverseHeld',
      blend: 'erase',
    });
  });

  it('opens the clip over ground the map carries paint on, at its own bounds', () => {
    // Painted ground enters `held` as it stands — the rooms are padded, the paint is not —
    // because a pad on the paint would hand over the first fraction of a cell beyond it.
    const PAINTED: Polygon[] = [
      [
        [18, 0],
        [24, 0],
        [24, 8],
        [18, 8],
      ],
    ];
    const plan = tierPlan(scene({ sight: [LOOKING], painted: PAINTED }));
    const erases = polysOn(plan, 'inverseHeld');
    expect(erases).toHaveLength(2);
    expect(erases[1]).toMatchObject({ polys: PAINTED, grow: 0, blend: 'erase' });
    // Nothing painted is one erase, not two — the clip is the rooms alone.
    expect(polysOn(tierPlan(scene({ sight: [LOOKING] })), 'inverseHeld')).toHaveLength(1);
    // …and it opens the clip without opening a tier: paint reaches no target but this one, so
    // painted ground with no eyes on it and no cell in the record is as dark as any other. The
    // sweep and the record still say what shows there.
    const dark = tierPlan(scene({ painted: PAINTED }));
    expect(dark.ops.every((op) => op.target === 'inverseHeld' || op.kind !== 'polys')).toBe(true);
  });
});

describe('tierPlan — the cover', () => {
  it('measures off the frame and what the party holds, never off a sweep vertex', () => {
    // `drawFog`'s county-mask comment, as a row: a sweep reaches the whole map by line of
    // sight, and growing the cover to its rays put the map in the corner of a mask the size
    // of a county.
    const plan = tierPlan(scene({ sight: [UNOCCLUDED] }));
    expect(plan.cover).toEqual({
      minX: FRAME.minX - GROW,
      minY: FRAME.minY - GROW,
      maxX: FRAME.maxX + GROW,
      maxY: FRAME.maxY + GROW,
    });
  });

  it('grows to held ground that pokes past the frame', () => {
    // The frame is content-tight, and a room's padded reach can poke past it — that overhang
    // is the half the cover does have to follow.
    const YARD: Polygon = [
      [26, 1],
      [30, 1],
      [30, 4],
      [26, 4],
    ];
    const plan = tierPlan(scene({ rooms: [WEST, EAST, YARD] }));
    expect(plan.cover?.maxX).toBeCloseTo(30 + GROW);
    expect(plan.cover?.minX).toBeCloseTo(FRAME.minX - GROW);
  });

  it('covers nothing at all for a seat with no frame', () => {
    const plan = tierPlan(scene({ sight: [LOOKING], frame: null }));
    expect(plan).toMatchObject({ cover: null, ops: [] });
  });
});

describe('tierPlan — the tiers', () => {
  const region = brushed([
    [5, 4],
    [6, 4],
    [7, 4],
  ]);

  it('lands a DM-revealed room in the memory tier and never in live', () => {
    // Told is not the same as looked at: the party knows the layout because they were told,
    // and their own eyes are the only thing that makes anything current.
    const plan = tierPlan(scene({ sight: [LOOKING], revealed: [EAST] }));
    const revealed = polysOn(plan, 'mask').find((op) => op.polys[0] === EAST);
    expect(revealed).toMatchObject({ color: MASK_MEMORY_GREY, grow: GROW, blend: 'normal' });
    expect(polysOn(plan, 'live').flatMap((op) => op.polys)).toEqual([LOOKING]);
  });

  it('draws the memory under live, which is the max the two tiers want', () => {
    const plan = tierPlan(scene({ sight: [LOOKING], region, revealed: [EAST] }));
    const mask = opsOn(plan, 'mask');
    const grey = mask.map((op, i) => (op.kind !== 'sprite' ? i : -1)).filter((i) => i >= 0);
    const live = mask.findIndex((op) => op.kind === 'sprite' && op.source === 'live');
    expect(grey.length).toBe(2);
    expect(Math.max(...grey)).toBeLessThan(live);
  });

  it('grows a sweep by the sight pad, which is half what a room floor gets', () => {
    // A sight polygon stops on the wall segments' centreline; a room's floor stops half a band
    // inside it. Two measurements of the same buy-back, and swapping them swallows the stones.
    const plan = tierPlan(scene({ sight: [LOOKING] }));
    expect(polysOn(plan, 'live')[0]).toMatchObject({ grow: SWEEP_GROW, color: MASK_LIVE });
    expect(SWEEP_GROW).toBeLessThan(GROW);
  });

  it('counts the bits in the record, whatever survives the clip', () => {
    // `__fogProbe.memoryCells` answers "has the party's memory grown", not "how much of it is
    // drawn" — a cell on unzoned map is in the record and clipped out of the mask.
    expect(tierPlan(scene({ region, rooms: [] })).cells).toBe(3);
    expect(tierPlan(scene()).cells).toBe(0);
  });
});

describe('tierPlan — the night gate', () => {
  const night: NightSight = {
    lit: [
      [
        [6, 0],
        [8, 0],
        [8, 2],
        [6, 2],
      ],
    ],
    darkvision: [
      [
        [12, 0],
        [14, 0],
        [14, 2],
        [12, 2],
      ],
    ],
    pools: [],
  };

  it('exists only when the scene handed one over', () => {
    // Daylight and dusk count the whole sweep as lit, which is the mask every table played
    // before the dial existed — an unconditional gate would darken all of them.
    expect(opsOn(tierPlan(scene({ sight: [LOOKING] })), 'inverseSeeable')).toEqual([]);
    expect(opsOn(tierPlan(scene({ sight: [LOOKING], night })), 'inverseSeeable')).not.toEqual([]);
  });

  it('gates live sight alone, on the same complement trick, at the sight pad', () => {
    const plan = tierPlan(scene({ sight: [LOOKING], night, revealed: [EAST] }));
    const gate = opsOn(plan, 'inverseSeeable');
    expect(gate[0]).toMatchObject({ kind: 'rect', rect: plan.cover });
    expect(gate[1]).toMatchObject({
      kind: 'polys',
      polys: [...night.lit, ...night.darkvision],
      grow: SWEEP_GROW,
      blend: 'erase',
    });
    // On `live`, and nowhere near the mask: unlit ground the party has already explored is
    // still remembered — it is only not current.
    expect(opsOn(plan, 'live').at(-1)).toMatchObject({
      kind: 'sprite',
      source: 'inverseSeeable',
      blend: 'erase',
    });
    expect(opsOn(plan, 'mask').some((op) => op.kind === 'sprite' && op.source === 'inverseSeeable')).toBe(
      false,
    );
  });

  it('gates nothing when there is no sweep to gate', () => {
    expect(opsOn(tierPlan(scene({ night, revealed: [EAST] })), 'inverseSeeable')).toEqual([]);
  });

  it('leaves a party with no light at all looking at nothing', () => {
    // Every torch out and no darkvision eye: the gate is a full cover with nothing erased back
    // out of it, so erasing it takes the whole of live sight. The memory tier is untouched —
    // what the dark takes away is the live tier, never the record.
    const blind = tierPlan(scene({ sight: [LOOKING], night: { lit: [], darkvision: [], pools: [] } }));
    expect(opsOn(blind, 'inverseSeeable')).toEqual([
      { kind: 'rect', target: 'inverseSeeable', rect: blind.cover, color: MASK_LIVE, blend: 'normal' },
    ]);
    expect(opsOn(blind, 'live').at(-1)).toMatchObject({ source: 'inverseSeeable', blend: 'erase' });
  });
});

describe('tierPlan — the record as a texture', () => {
  it('carries every bit of the record into texture bytes one for one', () => {
    const cells: [number, number][] = [
      [0, 0],
      [5, 4],
      [23, 7],
    ];
    const region = brushed(cells);
    const tex = cellTexture(region) as NonNullable<ReturnType<typeof cellTexture>>;
    expect(tex).toMatchObject({ cols: 24, rows: 8, minX: 0, minY: 0 });
    expect(tex.data).toHaveLength(24 * 8 * 4);

    const set = new Set(cells.map(([c, r]) => r * 24 + c));
    let wrong = 0;
    for (let i = 0; i < 24 * 8; i++) {
      const opaque = tex.data[i * 4 + 3] === 255;
      // Premultiplied by construction: opaque white or transparent black, so the linear
      // upscale does not bleed colour out from under a clear texel.
      const white = tex.data[i * 4] === (opaque ? 255 : 0);
      if (opaque !== set.has(i) || !white) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('is nothing at all for a record with no bits set — and no draw for it either', () => {
    expect(cellTexture(undefined)).toBeNull();
    expect(cellTexture(regionOf(FRAME)!)).toBeNull();
    const plan = tierPlan(scene({ rooms: [], region: regionOf(FRAME)! }));
    expect(plan.ops.some((op) => op.kind === 'cells')).toBe(false);
  });

  it('uploads it at the memory grey, linearly, under everything live', () => {
    const plan = tierPlan(scene({ rooms: [], region: brushed([[6, 0]]), sight: [UNOCCLUDED] }));
    expect(opsOn(plan, 'mask')[0]).toMatchObject({
      kind: 'cells',
      color: MASK_MEMORY_GREY,
      blurCells: MEMORY_BLUR_CELLS,
      blend: 'normal',
    });
  });
});

// ── Contained sight ─────────────────────────────────────────────────────────
// The contract both halves of the feature implement (P1 server / P2 client), as rows:
//
//   live = (full ∩ held) ∪ (near ∩ shipped ∖ locks)
//
// `held` narrows from "every room you were handed" to "the ground the DM has opened" — the
// record's runs plus the rooms revealed by hand — and the near pass is what a step buys back:
// each eye's own line of sight taken at its own range, fenced to the ground whose art this
// seat actually holds. Every row here is mutation-checked against the same three cuts: drop
// the shipping clip, drop the lock subtraction, or let the near term into `held` (which is the
// global-union shortcut, where one eye's long sweep opens ground round another's feet).

describe('tierPlan — contained sight', () => {
  /** The record the DM has opened: the west hall, cell for cell. Nothing past the wall. */
  const OPENED = brushed(
    Array.from({ length: 6 }, (_, col) =>
      Array.from({ length: 6 }, (_, row) => [4 + col, row] as [number, number]),
    ).flat(),
  );
  /** Line of sight through an open door: both halls, end to end. */
  const FULL: Polygon = [
    [4, 0],
    [16, 0],
    [16, 6],
    [4, 6],
  ];
  /** …and the same eye's sweep taken at its own range instead. */
  const NEAR: Polygon = [
    [6, 0],
    [12, 0],
    [12, 6],
    [6, 6],
  ];
  /** A second eye, standing elsewhere with a shorter reach. */
  const NEAR_B: Polygon = [
    [13, 0],
    [15, 0],
    [15, 2],
    [13, 2],
  ];
  const LOCK: Polygon = [
    [13, 0],
    [16, 0],
    [16, 6],
    [13, 6],
  ];

  const hall = () => fenced({ sight: [FULL], near: [NEAR], region: OPENED });
  const liveOn = (plan: DrawPlan) => opsOn(plan, 'live');

  it('R1 — fences the full sweep at opened ground and buys the rest back by range', () => {
    // The whole feature in one plan. The full sweep is clipped to `held ∪ nearTerm`, and the
    // near term is itself the range sweep less the locks and outside-shipped ground — so the
    // lit hall *inside the same line of sight* but past the eye's range is on neither term and
    // stays dark. Mutation: drop `nearTerm`'s own shipping erase and the near sweep runs to its
    // raw polygon, which on a roomless map is `SIGHT_REACH` past every edge.
    const plan = tierPlan(hall());
    expect(liveOn(plan)).toMatchObject([
      { kind: 'polys', polys: [FULL], grow: SWEEP_GROW, color: MASK_LIVE, blend: 'normal' },
      { kind: 'sprite', source: 'inverseOpen', blend: 'erase' },
    ]);
    // The near term is composed on its own target and reaches `live` through the clip:
    // `inverseOpen = ¬(held ∪ nearTerm)`, so erasing it is `full ∩ (held ∪ nearTerm)`, which
    // is `(full ∩ held) ∪ nearTerm` because a near sweep is inside its own full sweep.
    expect(opsOn(plan, 'nearTerm')).toMatchObject([
      { kind: 'polys', polys: [NEAR], grow: SWEEP_GROW, color: MASK_LIVE, blend: 'normal' },
      { kind: 'sprite', source: 'inverseShipped', blend: 'erase' },
    ]);
    // (P7's frame strips follow; `the map edge` rows pin those.)
    expect(opsOn(plan, 'inverseOpen').slice(0, 3)).toMatchObject([
      { kind: 'rect', rect: plan.cover, color: MASK_LIVE, blend: 'normal' },
      { kind: 'polys', polys: regionRects(OPENED), grow: GROW, blend: 'erase' },
      { kind: 'sprite', source: 'nearTerm', blend: 'erase' },
    ]);
    // …and `held` really is the opened ground rather than the rooms, which is the narrowing.
    expect(polysOn(plan, 'inverseHeld')[0].polys).toEqual(regionRects(OPENED));
    // The shipping clip opens onto every room the seat holds art for and nothing else — on a
    // walled map that is exactly the rooms the party has already earned, so the near pass
    // discovers ground *inside* them and a genuinely new room arrives as a server credit plus
    // its reveal delta, never as a hole the client opened first. Held ground is deliberately
    // *not* unioned in: the record is half of held, so adding it would leave this clip unable
    // to clip the memory tier at all (the next row is what that cost).
    expect(polysOn(plan, 'inverseShipped')[0]).toMatchObject({
      polys: [WEST, EAST],
      grow: GROW,
      blend: 'erase',
    });
  });

  it('R1 — the near pass never widens the held clip, only the live target', () => {
    // The global-union mutation, killed: fold the near term into `held` instead and eye A's
    // full sweep opens the ground round eye B's feet. `inverseHeld` erases the opened record
    // and nothing else, whatever the near pass is.
    const plan = tierPlan(hall());
    const held = polysOn(plan, 'inverseHeld').flatMap((op) => op.polys);
    expect(held).not.toContain(NEAR);
    expect(held).not.toContain(FULL);
    expect(held).toEqual(regionRects(OPENED));
  });

  it('R2 — a cell the near pass earned is held ground on the next plan', () => {
    // The ratchet. The referee writes what the near pass opened into the record, so the very
    // next rebuild has it inside `held` and it is live from anywhere with line of sight —
    // walking extends sight and nothing shrinks.
    const walked = brushed([
      ...Array.from({ length: 6 }, (_, col) =>
        Array.from({ length: 6 }, (_, row) => [4 + col, row] as [number, number]),
      ).flat(),
      [10, 3],
      [11, 3],
    ]);
    const before = polysOn(tierPlan(hall()), 'inverseHeld')[0].polys;
    const after = polysOn(tierPlan(fenced({ sight: [FULL], near: [NEAR], region: walked })), 'inverseHeld')[0]
      .polys;
    expect(after).not.toEqual(before);
    expect(after).toEqual(regionRects(walked));
    // The fence has grown east past the wall, over exactly the cells the near pass opened —
    // `regionRects` merges a row into one run, so it is the run's reach that moved, not a
    // rectangle count.
    const reach = (polys: readonly Polygon[]) => Math.max(...polys.flat().map(([x]) => x));
    expect(reach(before)).toBe(10);
    expect(reach(after)).toBe(12);
  });

  it('R3 — keeps the near sweeps per eye, one polygon each', () => {
    // Two eyes, and the union is strictly per-eye: each near polygon is that eye's own line of
    // sight at its own range, so ground near eye B but behind a wall from it is opened by
    // neither. A union of discs — or of the two ranges — would open it, which is exactly the
    // shortcut this row exists to refuse.
    const plan = tierPlan(fenced({ sight: [FULL], near: [NEAR, NEAR_B], region: OPENED }));
    const near = polysOn(plan, 'nearTerm').at(0);
    expect(near?.polys).toEqual([NEAR, NEAR_B]);
    expect(near?.grow).toBe(SWEEP_GROW);
  });

  it('R4 — subtracts the locks from the range term alone, and from nothing else', () => {
    // A lock bites the range-earned term and nothing else. It is erased out of `nearTerm`,
    // grown by the sweep's own inflate so the two cancel and the authored zone is the fence —
    // and it appears on no other target, because `inverseShipped` clips the memory tier and
    // the whole mask, both of which held ground owns even inside a lock (the row below).
    const plan = tierPlan(fenced({ sight: [FULL], near: [NEAR], region: OPENED, locks: [LOCK] }));
    expect(opsOn(plan, 'nearTerm').at(1)).toMatchObject({
      kind: 'polys',
      polys: [LOCK],
      grow: SWEEP_GROW,
      color: MASK_LIVE,
      blend: 'erase',
    });
    // Mutation: drop the subtraction and the lock is simply absent from the plan.
    expect(opsOn(tierPlan(hall()), 'nearTerm')).toHaveLength(2);
    // …and it reaches no other target, least of all either clip.
    expect(plan.ops.filter((op) => op.kind === 'polys' && op.polys.includes(LOCK))).toHaveLength(1);
    expect(opsOn(plan, 'inverseShipped').every((op) => op.kind !== 'polys' || !op.polys.includes(LOCK))).toBe(true);
  });

  it('R4 — held ground inside a lock zone stays visible, live and remembered', () => {
    // "Held wins over locks", which is the referee's own order of tests (`seen` asks `held`
    // before it asks `inAnyLock`): the DM's brush and Open whole map write without a lock
    // filter, deliberately, so a cell the DM opened inside a lock is theirs. The mutation this
    // kills is the one the shipped build had — locks painted back into `inverseShipped`, which
    // is the final clip on `live` *and* on the mask, so a brushed cell inside a lock went dark
    // on both tiers.
    const inside = brushed([[14, 3]]);
    const plan = tierPlan(fenced({ sight: [FULL], near: [NEAR], region: inside, locks: [LOCK] }));
    const lockIn = (target: TierTarget) =>
      opsOn(plan, target).some((op) => op.kind === 'polys' && op.polys.includes(LOCK));
    // Nothing that clips the full term or the memory tier knows about the lock…
    expect(lockIn('inverseShipped')).toBe(false);
    expect(lockIn('inverseOpen')).toBe(false);
    expect(lockIn('inverseHeld')).toBe(false);
    // …and both of those clips carry the brushed cell as *erased* ground, which is what leaves
    // it shown on the live tier and grey on the memory one.
    for (const target of ['inverseHeld', 'inverseOpen'] as const) {
      expect(polysOn(plan, target)[0]).toMatchObject({
        polys: regionRects(inside),
        grow: GROW,
        blend: 'erase',
      });
    }
    expect(opsOn(plan, 'mask').at(-1)).toMatchObject({ source: 'inverseShipped', blend: 'erase' });
  });

  it('R5 — leaves the darkness gate the last word over the whole composition', () => {
    // The light gate applies *after* the union, unchanged: a cell the near pass earned beyond
    // every torch and outside darkvision is still dark. Ordering is the whole claim — gate
    // before the near term reaches `live` and a step would peel the cloud back in pitch black.
    const night: NightSight = { lit: [], darkvision: [], pools: [] };
    const plan = tierPlan(fenced({ sight: [FULL], near: [NEAR], region: OPENED, night }));
    const live = liveOn(plan);
    expect(live.at(-1)).toMatchObject({ kind: 'sprite', source: 'inverseSeeable', blend: 'erase' });
    const openAt = live.findIndex((op) => op.kind === 'sprite' && op.source === 'inverseOpen');
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(openAt).toBeLessThan(live.length - 1);
  });

  it('R6 — fences each seat by the record it was handed, and nothing else', () => {
    // Individual share needs no second shape here: the referee redacts `region` per seat and
    // the DM's preview substitutes the previewed seat's record upstream (`FogRenderer`'s
    // preview branch), so two seats are two records and two fences through one builder.
    const mine = polysOn(tierPlan(hall()), 'inverseHeld')[0].polys;
    const theirs = polysOn(
      tierPlan(fenced({ sight: [FULL], near: [NEAR], region: brushed([[12, 3]]) })),
      'inverseHeld',
    )[0].polys;
    expect(mine).not.toEqual(theirs);
    expect(theirs).toEqual(regionRects(brushed([[12, 3]])));
  });

  it('R7 — collapses to the range limit when the scene is already range-limited', () => {
    // `sightRangeLimit` on means the full sweep *is* the near sweep — the same memo entry,
    // the same polygon — so the rule degenerates to `near ∖ locks` inside the shipping clip
    // with no special case anywhere. Both passes draw the identical geometry, one on each
    // target, and the union of the two terms is that geometry again.
    const plan = tierPlan(fenced({ sight: [NEAR], near: [NEAR], region: OPENED }));
    expect(polysOn(plan, 'live').map((op) => op.polys)).toEqual([[NEAR]]);
    expect(polysOn(plan, 'nearTerm').map((op) => op.polys)).toEqual([[NEAR]]);
    expect(liveOn(plan).at(-1)).toMatchObject({ source: 'inverseOpen', blend: 'erase' });
  });

  it('R9 — gives a roomless map the record plus the near pass, bounded by the frame', () => {
    // The 1764-cell trap, fixed by the model rather than by a special case: an unoccluded
    // sweep on a battlemap used to auto-explore the whole map in one step. Contained, the full
    // term is still clipped to the record and the near term is bounded by the eye's range —
    // and the shipping clip is the frame, because a roomless map ships its image whole.
    const region = brushed([[6, 0]]);
    const plan = tierPlan(fenced({ rooms: [], region, sight: [UNOCCLUDED], near: [NEAR] }));
    expect(polysOn(plan, 'inverseHeld')[0].polys).toEqual(regionRects(region));
    expect(polysOn(plan, 'inverseShipped')[0]).toMatchObject({
      polys: [
        [
          [FRAME.minX, FRAME.minY],
          [FRAME.maxX, FRAME.minY],
          [FRAME.maxX, FRAME.maxY],
          [FRAME.minX, FRAME.maxY],
        ],
      ],
      grow: GROW,
      blend: 'erase',
    });
    // …and the mask's own last word is that same clip, not the held one — erasing `held` here
    // would take back every cell the near pass had just earned.
    expect(opsOn(plan, 'mask').at(-1)).toMatchObject({ source: 'inverseShipped', blend: 'erase' });
  });

  it('never clears fog over ground whose art has not shipped', () => {
    // Consequence 6 of the contract, as a row: a room the seat holds no geometry for is not in
    // `rooms`, so it is not in the shipping clip, so the near pass cannot open it however close
    // an eye stands. The referee's record write runs ahead of the player's approach, so the gap
    // closes itself within a state update — and it may only ever run this way round.
    const plan = tierPlan(fenced({ rooms: [WEST], sight: [FULL], near: [NEAR], region: OPENED }));
    expect(polysOn(plan, 'inverseShipped')[0].polys).toEqual([WEST]);
  });

  it('leaves the memory tier under the cloud where no room shipped to sit it on', () => {
    // The gate walk's flat black patch, as a row. `OPENED` runs east of `WEST`'s own wall, so
    // on a seat that holds only `WEST` those cells are memory grey painted over map with no
    // art behind it — which renders as void with the background's grid dots printing through,
    // and reads as a hole rather than as fog. The mask's last word has to cut it.
    //
    // Mutation: union `held` back into `shippedGround` and this clip stops clipping the tier
    // it is the last word on, because the record *is* half of held.
    const plan = tierPlan(fenced({ rooms: [WEST], sight: [FULL], near: [NEAR], region: OPENED }));
    const shipped = polysOn(plan, 'inverseShipped')[0].polys;
    for (const rect of regionRects(OPENED)) expect(shipped).not.toContainEqual(rect);
    // …and the tier really is drawn before that clip, so the clip is what decides it.
    expect(opsOn(plan, 'mask').map((op) => op.kind)).toEqual(['cells', 'sprite', 'sprite']);
    expect(opsOn(plan, 'mask').at(-1)).toMatchObject({ source: 'inverseShipped', blend: 'erase' });
  });

  it('keeps a remembered wall band grey — the clip grows past the floor by more than a cell', () => {
    // The other half of the wall-art regression. The referee may now record the one cell of
    // band around a room's floor (`nearAuthoredFloor`), because that is where the stones are
    // drawn — but the mask's last word is `¬shipped`, and if that erase were ungrown, or grown
    // by less than a cell, it would take the band straight back off the memory tier and the
    // walls of an explored room would be under the cloud again with nothing on the record to
    // blame. The two numbers have to be read together, so this row reads them together.
    //
    // Mutation: `grow: 0` on the `inverseShipped` erase, or `grow` shrunk below `PAD`.
    expect(GROW).toBeGreaterThanOrEqual(PAD);
    expect(PAD).toBeGreaterThanOrEqual(1);
    // `WEST` ends at x = 9.75, so this is the cell just outside it — the band its wall sits on.
    const band = brushed([[10, 3]]);
    const plan = tierPlan(fenced({ rooms: [WEST], sight: [LOOKING], region: band }));
    expect(polysOn(plan, 'inverseShipped')[0]).toMatchObject({ polys: [WEST], grow: GROW });
    // …and the tier that band lands on is drawn, with the clip after it rather than instead.
    expect(opsOn(plan, 'mask').map((op) => op.kind)).toEqual(['cells', 'sprite', 'sprite']);
    expect(plan.cells).toEqual(regionCells(band));
  });

  it('builds the shipping clip even with nothing to fence, because the mask leans on it', () => {
    // Fail-dark: `inverseShipped` is the mask's clip on a contained scene whether or not there
    // is a near pass, and a target nothing was erased into is a full white cover — which takes
    // the whole mask rather than leaving a stale hole in it.
    const plan = tierPlan(fenced());
    expect(opsOn(plan, 'inverseShipped')[0]).toMatchObject({ kind: 'rect', rect: plan.cover });
    expect(opsOn(plan, 'mask')).toEqual([
      { kind: 'sprite', target: 'mask', source: 'inverseShipped', blend: 'erase' },
    ]);
    // `inverseOpen` fails the same way and is built on the same terms: a white cover with the
    // held ground erased out, plus the near term whether or not there is one to erase.
    expect(opsOn(plan, 'inverseOpen').slice(0, 2)).toMatchObject([
      { kind: 'rect', rect: plan.cover, color: MASK_LIVE, blend: 'normal' },
      { kind: 'sprite', source: 'nearTerm', blend: 'erase' },
    ]);
    // …and with no near pass there is nothing on `nearTerm` at all, so that erase is a no-op
    // rather than a second statement of the fence.
    expect(opsOn(plan, 'nearTerm')).toEqual([]);
  });

  it('reads a player seat\'s locks off the referee\'s cell mask, not off zones', () => {
    // What a player's seat actually has: no zones (prep never travels), and the lock cells the
    // referee cut for it instead (`lockMaskFor`, decoded by `regionRects` in `FogRenderer`).
    // Same fence, one polygon per merged row run, and it lands where the DM's zones do.
    const seatLocks = regionRects(brushed([[14, 3], [15, 3]]));
    const plan = tierPlan(fenced({ sight: [FULL], near: [NEAR], region: OPENED, locks: seatLocks }));
    expect(opsOn(plan, 'nearTerm')).toMatchObject([
      { kind: 'polys', polys: [NEAR], blend: 'normal' },
      { kind: 'polys', polys: seatLocks, grow: SWEEP_GROW, blend: 'erase' },
      { kind: 'sprite', source: 'inverseShipped', blend: 'erase' },
    ]);
    // Mutation: a seat handed no mask has an unfenced near pass, which is the leak.
    expect(opsOn(tierPlan(fenced({ sight: [FULL], near: [NEAR], region: OPENED })), 'nearTerm')).toHaveLength(2);
  });
});

/**
 * R8 — the switch off is the shipped mask, op for op.
 *
 * Written out here as the builder stood before containment landed rather than captured as a
 * snapshot, because a snapshot records whatever the code did on the day it was taken and this
 * has to record what the code *is supposed to do*: a wrong plan checked in is a wrong plan
 * pinned. Deep-equal, not `toMatchObject`, so an op that merely appears is a failure too.
 */
const legacyPlan = (s: TierScene): DrawPlan => {
  const grow = s.pad + s.feather;
  const sweepGrow = sightPad(s.pad) + s.feather;
  const shaped = (polys: readonly Polygon[]) => polys.filter((p) => p.length >= 3);
  const rooms = shaped(s.rooms);
  const painted = shaped(s.painted ?? []);
  const held = rooms.length > 0 ? [...rooms] : regionRects(s.region);
  const cells = regionCells(s.region);
  if (!s.frame) return { cover: null, ops: [], cells };
  let [minX, minY, maxX, maxY] = [
    s.frame.minX - grow,
    s.frame.minY - grow,
    s.frame.maxX + grow,
    s.frame.maxY + grow,
  ];
  for (const [polys, p] of [
    [held, grow],
    [painted, 0],
  ] as const) {
    for (const poly of polys) {
      for (const [x, y] of poly) {
        minX = Math.min(minX, x - p);
        minY = Math.min(minY, y - p);
        maxX = Math.max(maxX, x + p);
        maxY = Math.max(maxY, y + p);
      }
    }
  }
  const cover = { minX, minY, maxX, maxY };
  const sight = shaped(s.sight);
  const revealed = shaped(s.revealed);
  const seeable = s.night ? shaped([...s.night.lit, ...s.night.darkvision]) : [];
  const memory = cellTexture(s.region);
  const ops: DrawOp[] = [
    { kind: 'rect', target: 'inverseHeld', rect: cover, color: MASK_LIVE, blend: 'normal' },
  ];
  if (held.length > 0) {
    ops.push({ kind: 'polys', target: 'inverseHeld', polys: held, grow, color: MASK_LIVE, blend: 'erase' });
  }
  if (painted.length > 0) {
    ops.push({ kind: 'polys', target: 'inverseHeld', polys: painted, grow: 0, color: MASK_LIVE, blend: 'erase' });
  }
  // P7: the void past the frame goes back over the clip.
  for (const rect of outsideFrame(cover, s.frame)) {
    ops.push({ kind: 'rect', target: 'inverseHeld', rect, color: MASK_LIVE, blend: 'normal' });
  }
  if (s.night && sight.length > 0) {
    ops.push({ kind: 'rect', target: 'inverseSeeable', rect: cover, color: MASK_LIVE, blend: 'normal' });
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
  if (sight.length > 0) {
    ops.push({ kind: 'polys', target: 'live', polys: sight, grow: sweepGrow, color: MASK_LIVE, blend: 'normal' });
    ops.push({ kind: 'sprite', target: 'live', source: 'inverseHeld', blend: 'erase' });
    if (s.night) ops.push({ kind: 'sprite', target: 'live', source: 'inverseSeeable', blend: 'erase' });
  }
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
    ops.push({ kind: 'polys', target: 'mask', polys: revealed, grow, color: MASK_MEMORY_GREY, blend: 'normal' });
  }
  if (sight.length > 0) ops.push({ kind: 'sprite', target: 'mask', source: 'live', blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'mask', source: 'inverseHeld', blend: 'erase' });
  // P8: the feather copy of the finished mask.
  ops.push({ kind: 'sprite', target: 'edge', source: 'mask', blend: 'normal', featherCells: EDGE_FEATHER_CELLS });
  ops.push({ kind: 'rect', target: 'scrim', rect: cover, color: 0x000000, blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' });
  // T6: the same strips, read as shown by both blurred copies.
  return { cover, ops, cells, beyond: outsideFrame(cover, s.frame) };
};

describe('tierPlan — containment off is the shipped mask (R8)', () => {
  const PAINTED: Polygon[] = [
    [
      [18, 0],
      [24, 0],
      [24, 8],
      [18, 8],
    ],
  ];
  const night: NightSight = { lit: [LOOKING], darkvision: [], pools: [] };
  const region = brushed([
    [5, 4],
    [6, 4],
  ]);

  const rows: [string, TierScene][] = [
    ['a walled map with one sweep', scene({ sight: [LOOKING] })],
    ['…and a record and a revealed room under it', scene({ sight: [LOOKING], region, revealed: [EAST] })],
    ['a roomless battlemap', scene({ rooms: [], region, sight: [UNOCCLUDED] })],
    ['painted ground beside the rooms', scene({ sight: [LOOKING], painted: PAINTED })],
    ['a scene the DM turned to darkness', scene({ sight: [LOOKING], night, region })],
    ['a party with no eyes at all', scene({ region, revealed: [EAST] })],
    ['a seat with no frame', scene({ sight: [LOOKING], frame: null })],
    // The switch, not the absence of the terms, is what turns the feature off: a near pass and
    // a lock zone sitting in the scene must still draw the pre-containment plan, op for op.
    // Nothing else in this table carries either — the review found the uncontained path was
    // only ever proved against scenes that had nothing for it to ignore.
    [
      'a near pass and locks the switch says to ignore',
      scene({ sight: [LOOKING], region, near: [LOOKING], locks: [EAST] }),
    ],
  ];

  it.each(rows)('%s draws exactly the pre-containment plan', (_name, s) => {
    expect(tierPlan(s)).toEqual(legacyPlan(s));
    // …and not one op mentions a target the feature introduced.
    const added: TierTarget[] = ['inverseShipped', 'nearTerm', 'inverseOpen'];
    expect(tierPlan(s).ops.some((op) => added.includes(op.target))).toBe(false);
  });

  it('changes the answer the moment the switch goes on, on every one of them', () => {
    // The row above is only worth having if the comparison can fail: flip each scene to
    // contained and the plan must stop matching the legacy builder.
    for (const [, s] of rows) {
      const flipped = { ...s, contained: true };
      if (!s.frame) continue; // no frame, no plan, nothing to differ about
      expect(tierPlan(flipped)).not.toEqual(legacyPlan(s));
    }
  });
});

describe('tierPlan — the scrim', () => {
  it('is opaque black with the finished mask erased out of it', () => {
    // One erase of the mask rather than a second set of holes, so the two layers cannot
    // disagree about where a hole is — and any pass that fails to run leaves it opaque.
    const plan = tierPlan(scene({ sight: [LOOKING] }));
    expect(opsOn(plan, 'scrim')).toEqual([
      { kind: 'rect', target: 'scrim', rect: plan.cover, color: 0x000000, blend: 'normal' },
      { kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' },
    ]);
  });
});

describe('tierPlan — rooms the DM drew (O1/O5)', () => {
  // Two drawn chambers with a joint between them, as this seat was shipped them: the
  // contours are the `Room.boundary` values the cut already carried, so the plan cannot
  // tell them from detected rooms and no row here needs a new branch. The occlusion is
  // upstream — the sweep arrives already cut off at the boundary — and what is pinned
  // here is that nothing in the composition undoes that.
  const DRAWN_HALL = hall(4, 10);
  const DRAWN_CRYPT = hall(12, 18);
  const drawn = (over: Partial<TierScene> = {}) =>
    scene({ rooms: [DRAWN_HALL, DRAWN_CRYPT], ...over });

  it('takes the drawn boundaries as the held sources, like any other room', () => {
    const inverse = opsOn(tierPlan(drawn({ sight: [LOOKING] })), 'inverseHeld');
    expect(inverse[1]).toMatchObject({
      kind: 'polys',
      polys: [DRAWN_HALL, DRAWN_CRYPT],
      grow: GROW,
      blend: 'erase',
    });
  });

  it('R5 mirror — a sweep stopped at a boundary is still fenced to opened ground', () => {
    // O5: no new sight rule at an aperture. A sweep that crossed an open joint composes
    // exactly as one that crossed a doorway — `(full ∩ held) ∪ near` — so the room beyond
    // shows only where the DM opened it, or where the token's own range reaches.
    const ACROSS: Polygon = hall(4, 18);
    const OPENED = brushed(
      Array.from({ length: 6 }, (_, col) =>
        Array.from({ length: 6 }, (_, row) => [4 + col, row] as [number, number]),
      ).flat(),
    );
    const plan = tierPlan(
      fenced({ rooms: [DRAWN_HALL, DRAWN_CRYPT], sight: [ACROSS], near: [hall(8, 14)], region: OPENED }),
    );
    const live = polysOn(plan, 'live');
    // The full sweep goes down first and is clipped; the near term is its own pass. Neither
    // is the raw polygon painted straight onto the mask.
    expect(live[0]).toMatchObject({ polys: [ACROSS], color: MASK_LIVE, blend: 'normal' });
    expect(opsOn(plan, 'live').some((op) => op.blend === 'erase')).toBe(true);
  });
});

describe('tierPlan — the Lighting pass: dark regions, darkness sources and the greyscale tier', () => {
  const square = (x: number): Polygon => [
    [x, 0],
    [x + 2, 0],
    [x + 2, 2],
    [x, 2],
  ];

  it('gates only the dark rooms when the level’s own ground is lit', () => {
    const plan = tierPlan(scene({ sight: [LOOKING], night: { lit: [], darkvision: [], pools: [], dark: [square(12)] } }));
    const ops = opsOn(plan, 'inverseSeeable');
    expect(ops.some((op) => op.kind === 'rect')).toBe(false);
    expect(polysOn(plan, 'inverseSeeable')[0]?.polys).toEqual([square(12)]);
  });

  it('gates the whole cover when the level itself is dark', () => {
    const plan = tierPlan(scene({ sight: [LOOKING], night: { lit: [], darkvision: [], pools: [] } }));
    expect(opsOn(plan, 'inverseSeeable')[0]?.kind).toBe('rect');
  });

  it('lays darkness sources over the gate after the light is erased: darkness beats light', () => {
    const plan = tierPlan(
      scene({ sight: [LOOKING], night: { lit: [square(6)], darkvision: [], pools: [], blind: [square(6)] } }),
    );
    const ops = opsOn(plan, 'inverseSeeable');
    const last = ops.at(-1) as PolyOp;
    expect(last.blend).toBe('normal');
    expect(last.polys).toEqual([square(6)]);
    expect(ops.findIndex((op) => op.blend === 'erase')).toBeLessThan(ops.length - 1);
  });

  it('builds the greyscale tier where darkvision sees and nothing lights, inside live sight', () => {
    const plan = tierPlan(
      scene({ sight: [LOOKING], night: { lit: [square(6)], darkvision: [square(12)], pools: [] } }),
    );
    const grey = opsOn(plan, 'grey');
    expect(grey[0]?.kind).toBe('rect');
    expect(grey.some((op) => op.kind === 'polys' && op.blend === 'erase')).toBe(true);
    expect(grey.at(-1)).toMatchObject({ kind: 'sprite', source: 'inverseLive', blend: 'erase' });
    expect(opsOn(plan, 'inverseLive').length).toBe(2);
  });

  it('draws no greyscale tier without a darkvision eye, or in daylight', () => {
    expect(opsOn(tierPlan(scene({ sight: [LOOKING], night: { lit: [square(6)], darkvision: [], pools: [] } })), 'grey')).toEqual([]);
    expect(opsOn(tierPlan(scene({ sight: [LOOKING] })), 'grey')).toEqual([]);
  });
});

describe('tierPlan — table fix pass §2.8', () => {
  /** Grass outside both halls: the open ground the referee stamps once an outdoor cell is known. */
  const GRASS: Polygon = [
    [16, 0],
    [24, 0],
    [24, 8],
    [16, 8],
  ];
  const TOKEN: Polygon = [
    [19, 3],
    [20, 3],
    [20, 4],
    [19, 4],
  ];

  it('keeps the open ground shipped after a room ships', () => {
    // The cave door opened and WEST shipped; the grass the player stood on must stay shipped.
    const plan = tierPlan(fenced({ rooms: [WEST], open: [GRASS] }));
    const shipped = polysOn(plan, 'inverseShipped').flatMap((op) => op.polys);
    expect(shipped).toContain(WEST);
    expect(shipped).toContain(GRASS);
  });

  it('ships the frame only while neither a room nor open ground has arrived', () => {
    const plan = tierPlan(fenced({ rooms: [], open: [] }));
    expect(polysOn(plan, 'inverseShipped')[0].polys).toEqual([
      [
        [FRAME.minX, FRAME.minY],
        [FRAME.maxX, FRAME.minY],
        [FRAME.maxX, FRAME.maxY],
        [FRAME.minX, FRAME.maxY],
      ],
    ]);
  });

  it("always draws the seat's own token and clears the cell under it, after every clip", () => {
    // No sight, no record, no rooms of its own: the token stands on ground nobody shipped.
    const plan = tierPlan(fenced({ rooms: [WEST], own: [TOKEN] }));
    const mask = opsOn(plan, 'mask');
    const clip = mask.findIndex((op) => op.kind === 'sprite' && op.blend === 'erase');
    const own = mask.findIndex((op) => op.kind === 'polys' && op.polys.includes(TOKEN));
    expect(clip).toBeGreaterThanOrEqual(0);
    expect(own).toBeGreaterThan(clip);
    expect(mask[own]).toMatchObject({ blend: 'normal', color: MASK_LIVE });
    const live = opsOn(plan, 'live');
    expect(live[live.length - 1]).toMatchObject({ kind: 'polys', polys: [TOKEN], blend: 'normal' });
  });

  it('adds nothing for a seat with no token of its own', () => {
    const plan = tierPlan(fenced({ rooms: [WEST] }));
    expect(opsOn(plan, 'live')).toEqual([]);
  });
});

/**
 * A CPU reading of a plan: whether a target is covered at one world point once its ops have
 * run. Binary (a grown poly covers a point within `grow` of it), which is all an edge row needs.
 */
function coveredAt(plan: DrawPlan, target: TierTarget, x: number, y: number): boolean {
  const c = plan.cover;
  if (!c || x < c.minX || y < c.minY || x > c.maxX || y > c.maxY) return false;
  const inside = (p: Polygon): boolean => {
    let hit = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const near = (p: Polygon, r: number): boolean =>
    p.some(([ax, ay], i) => {
      const [bx, by] = p[(i + 1) % p.length];
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= r;
    });
  let on = false;
  for (const op of plan.ops) {
    if (op.target !== target) continue;
    let hit: boolean;
    if (op.kind === 'rect') hit = x >= op.rect.minX && x <= op.rect.maxX && y >= op.rect.minY && y <= op.rect.maxY;
    else if (op.kind === 'polys') hit = op.polys.some((p) => (!op.outline && inside(p)) || (op.grow > 0 && near(p, op.grow)));
    else if (op.kind === 'cells') {
      const [col, row] = [Math.floor(x - op.cells.minX), Math.floor(y - op.cells.minY)];
      hit = col >= 0 && row >= 0 && col < op.cells.cols && row < op.cells.rows && op.cells.data[(row * op.cells.cols + col) * 4 + 3] > 0;
    } else hit = coveredAt(plan, op.source, x, y);
    if (hit) on = op.blend === 'normal';
  }
  return on;
}

describe('tierPlan — the map edge (P7)', () => {
  // A token one cell in from the frame's right edge, with a 12-cell range on open ground: its
  // sweep runs well past the edge, and so would every grow the plan puts on it.
  const TOKEN_AT: [number, number] = [22.5, 4.5];
  const REACH: Polygon = [
    [TOKEN_AT[0] - 12, TOKEN_AT[1] - 12],
    [TOKEN_AT[0] + 12, TOKEN_AT[1] - 12],
    [TOKEN_AT[0] + 12, TOKEN_AT[1] + 12],
    [TOKEN_AT[0] - 12, TOKEN_AT[1] + 12],
  ];
  const SEEN = brushed(
    Array.from({ length: 8 }, (_, row) => Array.from({ length: 13 }, (_, i) => [11 + i, row] as [number, number])).flat(),
  );
  const OPEN: Polygon = [
    [0, 0],
    [24, 0],
    [24, 8],
    [0, 8],
  ];
  const OUTSIDE: [number, number][] = [
    [24.3, 4.5],
    [25.2, 4.5],
    [22.5, 8.4],
    [22.5, -0.6],
    [24.4, 8.4],
  ];

  const rows: [string, TierScene][] = [
    ['uncontained, a roomless map', scene({ rooms: [], sight: [REACH], region: SEEN })],
    ['contained, open ground', fenced({ rooms: [], open: [OPEN], sight: [REACH], near: [REACH], region: SEEN })],
    ['contained, nothing shipped yet', fenced({ rooms: [], sight: [REACH], near: [REACH], region: SEEN })],
  ];

  it.each(rows)('%s: shows sight up to the edge and nothing past it', (_name, s) => {
    const plan = tierPlan(s);
    expect(coveredAt(plan, 'live', 23.5, 4.5)).toBe(true);
    expect(coveredAt(plan, 'mask', 23.5, 4.5)).toBe(true);
    for (const [x, y] of OUTSIDE) {
      expect(coveredAt(plan, 'live', x, y)).toBe(false);
      expect(coveredAt(plan, 'mask', x, y)).toBe(false);
      // …and the scrim stays down out there.
      expect(coveredAt(plan, 'scrim', x, y)).toBe(true);
    }
  });

  it('cuts the strips off the cover, not the frame', () => {
    const cover = { minX: -2, minY: -2, maxX: 26, maxY: 10 };
    const strips = outsideFrame(cover, FRAME);
    expect(strips).toHaveLength(4);
    const area = strips.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxY - r.minY), 0);
    expect(area).toBe(28 * 12 - 24 * 8);
  });
});

describe('tierPlan — the soft edge (P8)', () => {
  it('blurs the finished mask into the feather target, then clears the own token over it', () => {
    const TOKEN: Polygon = [
      [6, 1],
      [7, 1],
      [7, 2],
      [6, 2],
    ];
    const plan = tierPlan(fenced({ rooms: [WEST], sight: [LOOKING], own: [TOKEN] }));
    expect(opsOn(plan, 'edge')).toEqual([
      { kind: 'sprite', target: 'edge', source: 'mask', blend: 'normal', featherCells: EDGE_FEATHER_CELLS },
      { kind: 'polys', target: 'edge', polys: [TOKEN], grow: 0, color: MASK_LIVE, blend: 'normal' },
    ]);
    // The feather samples the mask after its last clip, so it can only soften what the mask shows.
    const order = plan.ops.map((op) => op.target);
    expect(order.indexOf('edge')).toBeGreaterThan(order.lastIndexOf('mask'));
  });

  // A straight boundary, blurred: coverage is the normal CDF of the inward distance. `erf` by
  // Abramowitz and Stegun 7.1.26, good to 1.5e-7.
  const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const SIGMA = EDGE_FEATHER_CELLS / 2;
  const coverage = (inward: number): number => 0.5 * (1 + erf(inward / (SIGMA * Math.SQRT2)));
  const STEP = 0.02;
  const xs = Array.from({ length: 301 }, (_, i) => -2 + i * STEP);

  it.each([
    ['live sight', 1],
    ['a memory', 0.5],
  ])('takes %s from hidden to its tier over the feather, with no hard step', (_name, tier) => {
    const m = xs.map((x) => tier * edgeFeather(coverage(x)));
    // Nothing is lifted on or past the boundary: hidden stays exactly hidden.
    xs.forEach((x, i) => {
      if (x <= 0) expect(m[i]).toBeCloseTo(0, 6);
    });
    // Monotone inward, and every 0.02-cell step under 5% of the tier: a ramp, not a cut.
    for (let i = 1; i < m.length; i++) {
      expect(m[i]).toBeGreaterThanOrEqual(m[i - 1]);
      expect(m[i] - m[i - 1]).toBeLessThan(0.05 * tier);
    }
    // Half way up within the feather, and the whole tier a little past it.
    const at = (x: number): number => m[Math.round((x + 2) / STEP)];
    expect(at(EDGE_FEATHER_CELLS)).toBeGreaterThan(0.5 * tier);
    expect(at(2 * EDGE_FEATHER_CELLS)).toBeGreaterThan(0.99 * tier);
  });

  it('replaces a cut: the shader floored a shown texel at the memory grey, a 0.5 step at the line', () => {
    // The pre-P8 read: hidden texels flat at 0, a live texel never under 0.5.
    const before = xs.map((x) => (x > 0 ? Math.max(0.5, 2 * coverage(x) - 1) : 0));
    const jump = Math.max(...before.slice(1).map((v, i) => v - before[i]));
    expect(jump).toBeGreaterThanOrEqual(0.5);
  });
});

describe('open ground with holes (P8, the sliver)', () => {
  // A base-ground level as the referee sends it: the frame, then a cave the seat has not earned.
  const CAVE: Polygon = [
    [10, 2],
    [14, 2],
    [14, 6],
    [10, 6],
  ];
  const OPEN_FRAME: Polygon = [
    [0, 0],
    [24, 0],
    [24, 8],
    [0, 8],
  ];
  const doc = (rings: Polygon[]) => ({ openGround: [{ levelId: 'L', rings }] });

  it('keeps an unearned cave inside open ground off the shipping clip, rim band aside', () => {
    const { outers, holes } = openGroundParts(doc([OPEN_FRAME, CAVE]), 'L');
    expect(outers).toEqual([OPEN_FRAME]);
    expect(holes).toEqual([CAVE]);
    const plan = tierPlan(fenced({ rooms: [], open: outers, openHoles: holes, sight: [UNOCCLUDED], near: [UNOCCLUDED] }));
    // The cave's middle stays unshipped, so no sweep, near or far, can open it.
    expect(coveredAt(plan, 'inverseShipped', 12, 4)).toBe(true);
    expect(coveredAt(plan, 'mask', 12, 4)).toBe(false);
    // Its rock, seen from outside, is still shipped, and the grass round it shows.
    expect(coveredAt(plan, 'inverseShipped', 10.4, 4)).toBe(false);
    expect(coveredAt(plan, 'mask', 5, 4)).toBe(true);
  });

  it('reads the rings even-odd, so a second patch of ground is not taken for a hole', () => {
    const PATCH_B: Polygon = [
      [18, 1],
      [22, 1],
      [22, 5],
      [18, 5],
    ];
    const SMALL: Polygon = [
      [1, 1],
      [8, 1],
      [8, 7],
      [1, 7],
    ];
    const NOOK: Polygon = [
      [3, 3],
      [4, 3],
      [4, 4],
      [3, 4],
    ];
    const LINE: Polygon = [
      [5, 5],
      [6, 5],
      [5, 5],
    ];
    const { outers, holes } = openGroundParts(doc([SMALL, PATCH_B, NOOK, LINE]), 'L');
    expect(outers).toEqual([SMALL, PATCH_B]);
    expect(holes).toEqual([NOOK]);
  });
});

// ── T6: a crisp map edge, a soft shadow past it ─────────────────────────────
//
// No GL in this lane, so the shader's edge is checked through its TS twins (`onMapSample`,
// `frameShadow`, `edgeFeather`) over a one-row model of the mask as texels, blurred the way
// Pixi 8.17's BlurFilter does it: five Gaussian taps a pass, the first pass `strength /
// sqrt(sum of 4^-i)` texels apart and each later pass half that (`_applyOptimized`), every tap
// a linear read. A straight edge is a 1-D question, and the blur is separable.
describe('the map edge, crisp (T6)', () => {
  const TAPS = [0.153388, 0.221461, 0.250301, 0.221461, 0.153388];
  const read = (row: readonly number[], at: number): number => {
    const c = Math.min(row.length - 1, Math.max(0, at));
    const i = Math.floor(c);
    const f = c - i;
    return row[i] * (1 - f) + row[Math.min(row.length - 1, i + 1)] * f;
  };
  const pixiBlur = (row: readonly number[], strength: number, passes: number): number[] => {
    let sum = 0;
    for (let i = 0; i < passes; i++) sum += 4 ** -i;
    let spacing = strength / Math.sqrt(sum);
    let out = [...row];
    for (let p = 0; p < passes; p++) {
      const from = out;
      out = from.map((_, i) => TAPS.reduce((v, w, k) => v + w * read(from, i + (k - 2) * spacing), 0));
      spacing /= 2;
    }
    return out;
  };

  /**
   * One row of texels from x = -8 to 8 cells at `scale` texels a cell, the map's right edge at
   * x = 0. `tier(x)` is the hard mask; the feather's source is its coverage, and with `beyond`
   * the cover past the frame counts as shown, as the plan now asks of both blurs.
   */
  const modelRow = (scale: number, tier: (x: number) => number, beyond: boolean, passes = blurPasses(scale)) => {
    const n = 16 * scale;
    const at = (i: number): number => -8 + (i + 0.5) / scale;
    const mask = Array.from({ length: n }, (_, i) => (at(i) >= 0 ? 0 : tier(at(i))));
    const coverage = Array.from({ length: n }, (_, i) => (at(i) >= 0 ? (beyond ? 1 : 0) : mask[i] > 0 ? 1 : 0));
    const edge = pixiBlur(coverage, EDGE_FEATHER_CELLS * scale, passes);
    const frame = { minX: -8, minY: -1, maxX: 0, maxY: 1 };
    /** The shader's maskAt for a world x on the row: held on the map, then the tier times its feather. */
    return (x: number): number => {
      const [sx] = onMapSample(x, 0, frame, 1.5 / scale);
      const t = (sx + 8) * scale - 0.5;
      return read(mask, t) * edgeFeather(read(edge, t));
    };
  };

  it('reads the interior tier right up to the frame: no falloff on any tier', () => {
    for (const tier of [0.5, 1]) {
      const m = modelRow(24, () => tier, true);
      for (const x of [-2, -1, -0.5, -0.1, -0.02, -0.001]) expect(m(x)).toBeCloseTo(tier, 6);
      // …where P8 read the void past the frame as hidden ground and faded every tier into it.
      const before = modelRow(24, () => tier, false, 3);
      expect(before(-0.1)).toBeLessThan(0.1 * tier);
    }
  });

  it('asks the plan to count the cover past the frame as shown, and only that', () => {
    const plan = tierPlan(fenced({ rooms: [WEST], sight: [LOOKING] }));
    expect(plan.beyond).toEqual(outsideFrame(plan.cover!, FRAME));
    for (const r of plan.beyond!) {
      const overlapX = Math.min(r.maxX, FRAME.maxX) - Math.max(r.minX, FRAME.minX);
      const overlapY = Math.min(r.maxY, FRAME.maxY) - Math.max(r.minY, FRAME.minY);
      expect(overlapX <= 0 || overlapY <= 0).toBe(true);
    }
  });

  it('never samples the tier, the cloud or the shadow from past the frame for a point on the map', () => {
    const inset = 1.5 / 24;
    for (let x = -3; x <= 27; x += 0.25) {
      for (let y = -3; y <= 11; y += 0.25) {
        // Any point, warped any way: the tier is read on the map, the inset in from its edge.
        const [sx, sy] = onMapSample(x, y, FRAME, inset);
        expect(sx).toBeGreaterThanOrEqual(FRAME.minX + inset);
        expect(sx).toBeLessThanOrEqual(FRAME.maxX - inset);
        expect(sy).toBeGreaterThanOrEqual(FRAME.minY + inset);
        expect(sy).toBeLessThanOrEqual(FRAME.maxY - inset);
        const onMap = x >= FRAME.minX && x <= FRAME.maxX && y >= FRAME.minY && y <= FRAME.maxY;
        if (onMap) expect(frameShadow(x, y, FRAME)).toBe(0);
        // A point well on the map reads itself.
        if (x >= inset && x <= FRAME.maxX - inset && y >= inset && y <= FRAME.maxY - inset) {
          expect([sx, sy]).toEqual([x, y]);
        }
      }
    }
  });

  it('lays the shadow only past the frame, falling off smoothly over its width', () => {
    const STEP = 0.005;
    const d = Array.from({ length: Math.round(2 / STEP) + 1 }, (_, i) => i * STEP);
    const shade = d.map((t) => frameShadow(FRAME.maxX + t, 4, FRAME));
    expect(shade[0]).toBe(0); // on the edge itself: the map's, not the shadow's
    expect(shade[1]).toBeCloseTo(FRAME_SHADOW_DEPTH, 2);
    for (let i = 2; i < shade.length; i++) {
      expect(shade[i]).toBeLessThanOrEqual(shade[i - 1]);
      // No step anywhere along it: every 0.005 cell under 1% of the depth.
      expect(shade[i - 1] - shade[i]).toBeLessThan(0.01 * FRAME_SHADOW_DEPTH);
    }
    expect(frameShadow(FRAME.maxX + FRAME_SHADOW_CELLS, 4, FRAME)).toBe(0);
    expect(frameShadow(FRAME.maxX + 1.4 * FRAME_SHADOW_CELLS, 4, FRAME)).toBe(0);
    // It eases into the cloud rather than ending on a line.
    expect(frameShadow(FRAME.maxX + 0.95 * FRAME_SHADOW_CELLS, 4, FRAME)).toBeLessThan(0.01 * FRAME_SHADOW_DEPTH);
    // Rounded at a corner: the same reach diagonally as straight out.
    const r = 0.5;
    expect(frameShadow(FRAME.maxX + r / Math.SQRT2, FRAME.maxY + r / Math.SQRT2, FRAME)).toBeCloseTo(
      frameShadow(FRAME.maxX + r, 4, FRAME),
      9,
    );
  });

  // A memory running into hidden ground three cells inside the map. The analytic reference is
  // the same ramp through a true Gaussian of the blur's width (1.29 strength).
  const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const SIGMA = Math.sqrt(2 * (TAPS[0] * 4 + TAPS[1])) * EDGE_FEATHER_CELLS;
  const STEP = 0.005;
  const xs = Array.from({ length: Math.round(4 / STEP) + 1 }, (_, i) => -5 + i * STEP);
  const biggestStep = (m: (x: number) => number): number =>
    Math.max(...xs.slice(1).map((x, i) => m(x) - m(xs[i])));
  const smooth = biggestStep((x) => 0.5 * edgeFeather(0.5 * (1 + erf((x + 3) / (SIGMA * Math.SQRT2)))));
  const memory = (x: number): number => (x < -3 ? 0 : 0.5);

  it.each([6, 12, 24])('feathers between tiers as a clean gradient at %i texels a cell', (scale) => {
    const m = modelRow(scale, memory, true);
    expect(biggestStep(m)).toBeLessThanOrEqual(1.05 * smooth);
    for (let i = 1; i < xs.length; i++) expect(m(xs[i])).toBeGreaterThanOrEqual(m(xs[i - 1]) - 1e-12);
  });

  it('replaces a staircase: three passes at 24 texels a cell stepped every five texels', () => {
    expect(blurPasses(24)).toBe(6);
    expect(biggestStep(modelRow(24, memory, true, 3))).toBeGreaterThan(2 * smooth);
  });
});
