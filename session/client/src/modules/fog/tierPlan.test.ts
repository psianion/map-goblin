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
import { fogPad, regionCells, regionRects, sightPad, type NightSight } from './fog';
import { MASK_MEMORY } from './livingFog';
import {
  MASK_LIVE,
  MASK_MEMORY_GREY,
  MEMORY_BLUR_CELLS,
  cellTexture,
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
    expect(opsOn(plan, 'inverseOpen')).toMatchObject([
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
    expect(opsOn(plan, 'inverseOpen')).toMatchObject([
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
  ops.push({ kind: 'rect', target: 'scrim', rect: cover, color: 0x000000, blend: 'normal' });
  ops.push({ kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' });
  return { cover, ops, cells };
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
