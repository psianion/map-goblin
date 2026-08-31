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
import { fogPad, regionRects, sightPad, type NightSight } from './fog';
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

const scene = (over: Partial<TierScene> = {}): TierScene => ({
  sight: [],
  rooms: [WEST, EAST],
  revealed: [],
  pad: PAD,
  feather: FOG_FEATHER,
  frame: FRAME,
  ...over,
});

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
