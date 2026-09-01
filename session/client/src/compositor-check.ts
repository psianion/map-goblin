/**
 * GL truth for the raster tier compositor — docs/2026-09-01-raster-fog-mask-plan.md, P1a.
 *
 * jsdom has no GL, so `tierPlan.test.ts` can only pin the plan. What the plan *means* — that
 * an escaping sweep really is clipped, that the memory tier really is smooth, that the night
 * gate really cuts live sight and not the memory of it — is a readback question, and this page
 * is where it gets asked. Served on the client dev server at /compositor-check.html and driven
 * headless by `compositor-run.mjs`, on the P0 spike's pattern.
 *
 * Every scene here has an oracle: the same inputs through the Clipper pipeline this replaces,
 * sampled on a grid and compared area for area. The direction of the comparison matters more
 * than its size — the raster answer must be a *subset* of the vector one (plus a texel of
 * rasterisation slack), because fog may only ever fail dark.
 *
 * That pipeline is retired from the product and kept here, and only here: `__oracle__/vectorFog.ts`
 * is imported by this file alone, and only `compositor-check.html` reaches this file, so Vite
 * serves it in dev and no production bundle carries it. An import of it from anywhere under
 * `src/modules` would put Clipper back on the drag path this phase took it off.
 *
 * Readback note: `extract.pixels` on a RenderTexture is a raw `readPixels`, so the bytes here
 * are premultiplied — exactly what the cloud shader samples. A memory texel at alpha a reads
 * `0.5 · a` in `.r`, which is what makes the tier ramp rather than step.
 */
import { Application, Container, RenderTexture, Sprite, Text } from 'pixi.js';
import type { Clipper2ZFactoryFunction, MainModule } from 'clipper2-wasm/dist/clipper2z';
import clipper2WasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import { regionOf, setCells, toBytes, type RegionMask } from '@dnd/mechanics/fog';
import { FOG_FEATHER } from './modules/fog/FogRenderer';
import { fogPad, regionRects, ringsWithHoles, type NightSight, type FogRing } from './modules/fog/fog';
import { visionRegion } from './modules/fog/__oracle__/vectorFog';
import { createTierCompositor } from './modules/fog/tierCompositor';
import { tierPlan, type TierScene } from './modules/fog/tierPlan';
import type { Bounds } from './modules/fog/FogRenderer';

type Detail = Record<string, unknown>;
interface Check {
  pass: boolean;
  detail: Detail;
}

declare global {
  interface Window {
    __compositorResults?: Record<string, Check | boolean>;
  }
}

interface Px {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** What the raster mask and the vector oracle each claim is shown, on one grid. */
interface Areas {
  vectorAreaCells: number;
  rasterAreaCells: number;
  areaErrPct: number;
  /** The only one-sided number: raster shown where the vector says hidden, past a texel. */
  shownOutsideVectorCells: number;
  onlyVectorCells: number;
}

/** Texels per world unit. Inside `maskScale`'s 6..24 band, so the sampling is honest. */
const SCALE = 12;
const PAD = fogPad([]);
const GROW = PAD + FOG_FEATHER;

const round = (n: number, places = 2): number => Number(n.toFixed(places));

// ── Fixtures: the two-hall crypt `FogRenderer.test.ts` fogs ───────────────────
const hall = (x0: number, x1: number): Polygon => [
  [x0, 0],
  [x1, 0],
  [x1, 6],
  [x0, 6],
];
const WEST = hall(4, 9.75);
const EAST = hall(10.25, 16);
const FRAME: Bounds = { minX: 0, minY: 0, maxX: 24, maxY: 8 };

/** A sweep that runs clean off the ground the player holds — the county trap. */
const ESCAPING: Polygon = [
  [6, 0.5],
  [30, 0.5],
  [30, 3],
  [6, 3],
];
const LOOKING: Polygon = [
  [6, 0.5],
  [8, 0.5],
  [8, 2],
  [6, 2],
];

async function initClipper(): Promise<void> {
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const factory = mod.default as Clipper2ZFactoryFunction;
  setClipperModule(
    (await factory({
      locateFile: (path: string) => (path.endsWith('.wasm') ? clipper2WasmUrl : path),
    })) as MainModule,
  );
}

async function run(): Promise<void> {
  const app = new Application();
  await app.init({ width: 1100, height: 720, background: 0x1a1c19, antialias: false });
  document.getElementById('app')?.appendChild(app.canvas);
  await initClipper();

  const engine = {
    renderToTexture: (container: Container, texture: RenderTexture, clear = true): void => {
      app.renderer.render({ container, target: texture, clear });
    },
  };
  const comp = createTierCompositor(engine);
  const read = (rt: RenderTexture): Px => app.renderer.extract.pixels(rt) as Px;
  /** The cloud shader's own live remap of the soft copy: `clamp(2b − 1, 0, 1)`. */
  const remap = (b: number): number => Math.min(1, Math.max(0, 2 * (b / 255) - 1));

  /** The RGBA the cloud shader would sample at a world point — premultiplied, as stored. */
  const probe = (img: Px, cover: Bounds, x: number, y: number): number[] => {
    const tx = Math.floor(((x - cover.minX) / (cover.maxX - cover.minX)) * img.width);
    const ty = Math.floor(((y - cover.minY) / (cover.maxY - cover.minY)) * img.height);
    if (tx < 0 || ty < 0 || tx >= img.width || ty >= img.height) return [0, 0, 0, 0];
    const i = (ty * img.width + tx) * 4;
    return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]];
  };
  const alphaAt = (img: Px, cover: Bounds, x: number, y: number): number => probe(img, cover, x, y)[3];

  // ── The oracle: the same statement through the Clipper pipeline this replaces ──
  const covered = (nodes: readonly FogRing[], point: [number, number]): boolean =>
    nodes.some(({ outline, holes }) => pointInPolygon(point, outline) && !covered(holes, point));

  interface Scene {
    name: string;
    tier: TierScene;
    /** What `heldGround` hands `visionRegion` as `shipped` for this scene. */
    held: Polygon[];
    /** Contained scenes only: the rooms the seat holds art for, the near pass's own fence. */
    shippedGround?: Polygon[];
  }

  const composite = (scene: Scene): { cover: Bounds; mask: Px; scrim: Px; oracle: FogRing[] } => {
    const plan = tierPlan(scene.tier);
    const cover = comp.run(plan, { scale: SCALE, fade: 0.5 }) as Bounds;
    const region = visionRegion(
      scene.tier.sight,
      scene.tier.region,
      scene.tier.revealed,
      scene.held,
      scene.tier.pad,
      scene.tier.feather,
      scene.tier.night,
      scene.tier.painted ?? [],
      scene.tier.contained
        ? {
            near: scene.tier.near,
            shippedGround: scene.shippedGround,
            locks: scene.tier.locks,
          }
        : {},
    );
    return { cover, mask: read(comp.mask), scrim: read(comp.scrim), oracle: ringsWithHoles(region.shown) };
  };

  /**
   * Area agreement on a quarter-cell grid, and the one-sided rule that actually matters: a
   * raster texel may not be shown where the vector answer says hidden, unless a point within
   * one texel of it is shown. Fog fails dark or it does not fail.
   */
  const agree = (mask: Px, cover: Bounds, oracle: FogRing[]): Areas => {
    const step = 0.25;
    const texel = 1 / SCALE;
    let both = 0;
    let rasterOnly = 0;
    let vectorOnly = 0;
    let rasterOnlyStrict = 0;
    for (let x = cover.minX + step / 2; x < cover.maxX; x += step) {
      for (let y = cover.minY + step / 2; y < cover.maxY; y += step) {
        const raster = alphaAt(mask, cover, x, y) >= 128;
        const vector = covered(oracle, [x, y]);
        if (raster && vector) both++;
        else if (raster) {
          rasterOnly++;
          const near =
            covered(oracle, [x + texel, y]) ||
            covered(oracle, [x - texel, y]) ||
            covered(oracle, [x, y + texel]) ||
            covered(oracle, [x, y - texel]);
          if (!near) rasterOnlyStrict++;
        } else if (vector) vectorOnly++;
      }
    }
    const cell = step * step;
    const vectorArea = (both + vectorOnly) * cell;
    const rasterArea = (both + rasterOnly) * cell;
    return {
      vectorAreaCells: round(vectorArea, 1),
      rasterAreaCells: round(rasterArea, 1),
      areaErrPct: round(vectorArea > 0 ? (100 * Math.abs(rasterArea - vectorArea)) / vectorArea : 0, 2),
      shownOutsideVectorCells: round(rasterOnlyStrict * cell, 2),
      onlyVectorCells: round(vectorOnly * cell, 2),
    };
  };

  const results: Record<string, Check> = {};

  // ── (a) two rooms, one sweep escaping the ground the player holds ────────────
  {
    const scene: Scene = {
      name: 'a',
      tier: {
        sight: [ESCAPING],
        contained: false,
        rooms: [WEST, EAST],
        revealed: [],
        pad: PAD,
        feather: FOG_FEATHER,
        frame: FRAME,
      },
      held: [WEST, EAST],
    };
    const { cover, mask, oracle } = composite(scene);
    const areas = agree(mask, cover, oracle);
    const insideWest = probe(mask, cover, 7, 1.5);
    const insideEast = probe(mask, cover, 12, 1.5);
    const escaped = probe(mask, cover, 20.5, 1.5);
    const unseen = probe(mask, cover, 7, 5);
    results.twoRoomSweep = {
      pass:
        insideWest[0] > 247 && insideWest[3] > 247 &&
        insideEast[0] > 247 &&
        escaped[3] < 8 &&
        unseen[3] < 8 &&
        cover.maxX === FRAME.maxX + GROW &&
        areas.shownOutsideVectorCells === 0,
      detail: {
        liveInsideWestRGBA: insideWest,
        liveInsideEastRGBA: insideEast,
        escapedSweepRGBA: escaped,
        heldButUnsweptRGBA: unseen,
        coverMaxX: round(cover.maxX),
        sweepMaxX: 30,
        ...areas,
      },
    };
  }

  // ── (b) a memory-only record: the staircase, and the lone cell ───────────────
  {
    const STAIR: Bounds = { minX: 0, minY: 0, maxX: 16, maxY: 16 };
    const cells: [number, number][] = [];
    for (let col = 0; col < 12; col++) for (let row = col; row < 12; row++) cells.push([col, row]);
    cells.push([14, 2]); // the lone swept cell — MASK_SCALE = 3 was chosen against losing this
    const region: RegionMask = setCells(regionOf(STAIR) as RegionMask, cells);
    const held = regionRects(region);
    const scene: Scene = {
      name: 'b',
      tier: {
        sight: [],
        contained: false,
        rooms: [],
        revealed: [],
        region,
        pad: PAD,
        feather: FOG_FEATHER,
        frame: STAIR,
      },
      held,
    };
    const { cover, mask, oracle } = composite(scene);
    const areas = agree(mask, cover, oracle);

    const lone = probe(mask, cover, 14.5, 2.5);
    const interior = probe(mask, cover, 3.5, 8.5);
    const void_ = probe(mask, cover, 14.5, 10.5);

    // The boundary of the staircase (cells are set where row >= col) runs along y = x − 0.5.
    // A raw record alternates 0/1 along that line at one-cell period; a smooth field sits on
    // its half level. This is the "no single-cell alternation" row.
    const along: number[] = [];
    const raw: number[] = [];
    const bytes = toBytes(region.bits);
    for (let t = 2; t <= 10; t += 0.05) {
      along.push(alphaAt(mask, cover, t, t - 0.5) / 255);
      const [col, row] = [Math.floor(t), Math.floor(t - 0.5)];
      const bit = row * region.cols + col;
      raw.push((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0 ? 1 : 0);
    }
    const span = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    const mean = along.reduce((a, b) => a + b, 0) / along.length;
    const sd = Math.sqrt(along.reduce((a, b) => a + (b - mean) ** 2, 0) / along.length);

    // The bound that actually protects the seat, measured against the record rather than
    // against the other smoothing of it: no shown texel may sit on a cell the referee never
    // wrote. `maskRings` and the bilinear upscale are two different half-level contours of the
    // same bits, so they disagree by a fraction of a texel along a diagonal — that difference
    // is a look, not a leak, and this is the number that tells the two apart.
    const holds = (x: number, y: number): boolean => {
      const [col, row] = [Math.floor(x - region.minX), Math.floor(y - region.minY)];
      if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) return false;
      const bit = row * region.cols + col;
      return (bytes[bit >>> 3] & (1 << (bit & 7))) !== 0;
    };
    const texel = 1 / SCALE;
    let offRecord = 0;
    for (let x = cover.minX; x < cover.maxX; x += 0.25) {
      for (let y = cover.minY; y < cover.maxY; y += 0.25) {
        if (alphaAt(mask, cover, x, y) < 128) continue;
        if (holds(x, y) || holds(x + texel, y) || holds(x - texel, y) || holds(x, y + texel) || holds(x, y - texel)) {
          continue;
        }
        offRecord++;
      }
    }

    results.memoryTier = {
      pass:
        lone[3] > 247 && lone[0] > 120 && lone[0] < 136 &&
        interior[0] > 120 && interior[0] < 136 && interior[3] > 247 &&
        void_[3] < 8 &&
        span(along) < 0.25 &&
        offRecord === 0 &&
        areas.shownOutsideVectorCells <= 0.01 * areas.rasterAreaCells,
      detail: {
        loneCellRGBA: lone,
        interiorRGBA: interior,
        neverRecordedRGBA: void_,
        diagonalMean: round(mean, 3),
        diagonalSpan: round(span(along), 3),
        diagonalStdDev: round(sd, 3),
        rawRecordSpanAlongTheSameLine: round(span(raw), 3),
        shownOffTheRecordCells: round(offRecord * 0.0625, 2),
        ...areas,
      },
    };
  }

  // ── (c) the night gate: live clipped to lit + darkvision ────────────────────
  {
    const BIG: Polygon = [
      [4, 0],
      [16, 0],
      [16, 6],
      [4, 6],
    ];
    const night: NightSight = {
      lit: [
        [
          [4.5, 1.5],
          [7.5, 1.5],
          [7.5, 4.5],
          [4.5, 4.5],
        ],
      ],
      darkvision: [
        [
          [12, 1],
          [14, 1],
          [14, 3],
          [12, 3],
        ],
      ],
      pools: [],
    };
    const base: TierScene = {
      sight: [BIG],
      contained: false,
      rooms: [WEST, EAST],
      revealed: [],
      pad: PAD,
      feather: FOG_FEATHER,
      frame: FRAME,
    };
    const dark = composite({ name: 'c', tier: { ...base, night }, held: [WEST, EAST] });
    const inLight = probe(dark.mask, dark.cover, 6, 3);
    const inDarkvision = probe(dark.mask, dark.cover, 13, 2);
    const unlit = probe(dark.mask, dark.cover, 9, 5);
    // The mutation: the same sweep with no gate lights the whole hall.
    const day = composite({ name: 'c-day', tier: base, held: [WEST, EAST] });
    const dayUnlit = probe(day.mask, day.cover, 9, 5);
    const areas = agree(dark.mask, dark.cover, dark.oracle);

    results.nightGate = {
      pass:
        inLight[0] > 247 && inDarkvision[0] > 247 &&
        unlit[3] < 8 &&
        dayUnlit[0] > 247 &&
        areas.shownOutsideVectorCells === 0,
      detail: {
        inTorchlightRGBA: inLight,
        inDarkvisionRGBA: inDarkvision,
        sweptButUnlitRGBA: unlit,
        sameTexelInDaylightRGBA: dayUnlit,
        ...areas,
      },
    };
  }

  // ── (d) a room the DM revealed is a memory, never live ──────────────────────
  {
    const scene: Scene = {
      name: 'd',
      tier: {
        sight: [LOOKING],
        contained: false,
        rooms: [WEST, EAST],
        revealed: [EAST],
        pad: PAD,
        feather: FOG_FEATHER,
        frame: FRAME,
      },
      held: [WEST, EAST],
    };
    const { cover, mask, oracle } = composite(scene);
    const areas = agree(mask, cover, oracle);
    const told = probe(mask, cover, 13, 3);
    const seen = probe(mask, cover, 7, 1);
    results.revealedIsMemory = {
      pass:
        told[3] > 247 && told[0] > 120 && told[0] < 136 &&
        seen[0] > 247 && seen[3] > 247 &&
        areas.shownOutsideVectorCells === 0,
      detail: {
        dmRevealedRoomRGBA: told,
        partyIsLookingRGBA: seen,
        ...areas,
      },
    };

    // ── (e) the scrim: black cover with the finished mask erased out of it ─────
    const scrim = read(comp.scrim);
    let offBy = 0;
    let worst = 0;
    for (let i = 0; i < mask.pixels.length; i += 4) {
      const want = 255 - mask.pixels[i + 3];
      const got = scrim.pixels[i + 3];
      worst = Math.max(worst, Math.abs(got - want));
      if (Math.abs(got - want) > 4) offBy++;
    }
    results.scrimErase = {
      pass:
        probe(scrim, cover, 7, 1)[3] < 8 &&
        probe(scrim, cover, 20.5, 1.5)[3] > 247 &&
        offBy === 0,
      detail: {
        underTheSweepRGBA: probe(scrim, cover, 7, 1),
        overHiddenGroundRGBA: probe(scrim, cover, 20.5, 1.5),
        texelsOffTheMaskComplement: offBy,
        worstAlphaError: worst,
        texelsChecked: mask.pixels.length / 4,
      },
    };
  }

  // ── (f) the soft copy the cloud remaps, over a premultiplied mask ───────────
  // The P0 caveat, discharged: the mask now clears *transparent* rather than to opaque black,
  // so `maskSoft` is a blur of premultiplied texels and the grey tier is where that can bite.
  // The shader's contract is unchanged and is what this measures — `2b − 1` reads 1 well
  // inside live sight, 0 where live meets hidden (a 1|0 edge blurs to 0.5) and 0.5 where live
  // meets a memory (a 1|0.5 edge blurs to 0.75).
  {
    const soften = (revealed: Polygon[]): { cover: Bounds; hard: Px; soft: Px } => {
      const { cover, mask } = composite({
        name: 'f',
        tier: {
          sight: [LOOKING],
          contained: false,
          rooms: [WEST, EAST],
          revealed,
          pad: PAD,
          feather: FOG_FEATHER,
          frame: FRAME,
        },
        held: [WEST, EAST],
      });
      return { cover, hard: mask, soft: read(comp.maskSoft) };
    };

    /**
     * Walk down the ray out of live sight and answer the remap at the last texel the *hard*
     * mask still calls live — which is the only place the shader reads it (`maskAt` returns
     * the sharp value below 0.99). Found by walking rather than by a fixed point, because
     * where the rim falls is the pad's business and this row is about the value there.
     */
    const atTheRim = (m: { cover: Bounds; hard: Px; soft: Px }): { edge: number; beyond: number } => {
      const steps = 600;
      let last: [number, number] = [7, 1.2];
      for (let i = 1; i <= steps; i++) {
        const y = 1.2 + (5.5 - 1.2) * (i / steps);
        if (probe(m.hard, m.cover, 7, y)[0] < 250) {
          return {
            edge: remap(probe(m.soft, m.cover, last[0], last[1])[0]),
            beyond: probe(m.hard, m.cover, 7, y)[0],
          };
        }
        last = [7, y];
      }
      return { edge: NaN, beyond: NaN };
    };

    const overMemory = soften([WEST]); // the sweep sits inside a room the DM revealed
    const overVoid = soften([]); // …and the same sweep with nothing remembered around it
    const inside = remap(probe(overMemory.soft, overMemory.cover, 7, 1.2)[0]);
    const memoryEdge = atTheRim(overMemory);
    const hiddenEdge = atTheRim(overVoid);

    results.maskSoftRemap = {
      pass:
        inside > 0.9 &&
        hiddenEdge.edge < 0.35 &&
        memoryEdge.edge > 0.25 &&
        memoryEdge.edge < 0.75 &&
        memoryEdge.beyond > 120 &&
        memoryEdge.beyond < 136 &&
        hiddenEdge.beyond < 8,
      detail: {
        insideLiveSight: round(inside, 3),
        atTheMemoryEdge: round(memoryEdge.edge, 3),
        theTexelBeyondIt: memoryEdge.beyond,
        atTheHiddenEdge: round(hiddenEdge.edge, 3),
        andBeyondThatOne: hiddenEdge.beyond,
        note: 'clamp(2b-1): 1 inside live, ~0.5 against a memory, ~0 against hidden',
      },
    };
  }

  // ── (g) contained sight on a walled map — the R1 row, in GL ─────────────────
  // An eye standing in ground the DM has opened, looking down a hall it has not. The held room
  // is live end to end; the hall opens only as far as the eye's own range reaches, and the lit
  // ground beyond that — inside the same unbroken line of sight, on a room whose art this seat
  // was shipped — stays dark. That last texel is the whole feature: uncontained it is white,
  // and the mutation below is exactly that scene with the switch off.
  {
    // The record the DM has opened: the west hall's cells, and nothing east of the wall.
    const opened: [number, number][] = [];
    for (let col = 4; col <= 9; col++) for (let row = 0; row <= 5; row++) opened.push([col, row]);
    const region: RegionMask = setCells(regionOf(FRAME) as RegionMask, opened);
    const held = regionRects(region);
    // Line of sight through the open door: both halls, wall to wall.
    const FULL: Polygon = [
      [4, 0],
      [16, 0],
      [16, 6],
      [4, 6],
    ];
    // …and the same sweep taken at the eye's own range instead — an eye at (9, 3) reaching 3.
    const NEAR: Polygon = [
      [6, 0],
      [12, 0],
      [12, 6],
      [6, 6],
    ];
    const tier: TierScene = {
      sight: [FULL],
      contained: true,
      near: [NEAR],
      rooms: [WEST, EAST],
      revealed: [],
      region,
      pad: PAD,
      feather: FOG_FEATHER,
      frame: FRAME,
    };
    const shippedGround = [WEST, EAST, ...held];
    const { cover, mask, oracle } = composite({ name: 'g', tier, held, shippedGround });
    const areas = agree(mask, cover, oracle);

    const inOpened = probe(mask, cover, 7, 3); // held ground, live by line of sight alone
    const earned = probe(mask, cover, 11, 3); // the hall, within the eye's own range
    const beyond = probe(mask, cover, 14, 3); // the hall, in sight but past the range
    // The mutation: the identical scene uncontained opens the whole hall, which is what the
    // fence is measured against.
    const off = composite({ name: 'g-off', tier: { ...tier, contained: false }, held: [WEST, EAST] });
    const beyondUncontained = probe(off.mask, off.cover, 14, 3);

    results.containedSight = {
      pass:
        inOpened[0] > 247 && inOpened[3] > 247 &&
        earned[0] > 247 && earned[3] > 247 &&
        beyond[3] < 8 &&
        beyondUncontained[0] > 247 &&
        areas.shownOutsideVectorCells === 0,
      detail: {
        insideOpenedGroundRGBA: inOpened,
        earnedByRangeRGBA: earned,
        inSightPastTheRangeRGBA: beyond,
        sameTexelUncontainedRGBA: beyondUncontained,
        ...areas,
      },
    };
  }

  // ── report ──────────────────────────────────────────────────────────────────
  const allPass = Object.values(results).every((r) => r.pass);
  window.__compositorResults = { ...results, allPass };

  const lines = Object.entries(results).map(
    ([name, r]) => `[COMPOSITOR] ${name} ${r.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(r.detail)}`,
  );
  lines.push(`[COMPOSITOR] all ${allPass ? 'PASS' : 'FAIL'}`);
  for (const line of lines) console.log(line);

  const out = document.getElementById('out');
  if (out) {
    out.textContent = lines.join('\n');
    out.className = allPass ? 'pass' : 'fail';
  }
  // The targets are reused across scenes, so only the last one composited can be shown —
  // scene (d) and the scrim built from it. The numbers above are the actual check.
  const gallery: [RenderTexture, string][] = [
    [comp.mask, 'd mask — revealed room grey, the sweep white'],
    [comp.scrim, 'e scrim — holes exactly where the mask is'],
  ];
  gallery.forEach(([rt, label], i) => {
    const s = new Sprite(rt);
    s.position.set(20 + (i % 3) * 360, 40 + Math.floor(i / 3) * 240);
    s.scale.set(Math.min(340 / rt.width, 190 / rt.height));
    const t = new Text({ text: label, style: { fill: 0xdcdcd4, fontSize: 11 } });
    t.position.set(s.x, s.y - 14);
    app.stage.addChild(s, t);
  });
}

run().catch((err: unknown) => {
  console.error('[COMPOSITOR] threw', err);
  const out = document.getElementById('out');
  if (out) {
    out.textContent = `[COMPOSITOR] threw: ${String(err)}`;
    out.className = 'fail';
  }
  window.__compositorResults = { threw: { pass: false, detail: { error: String(err) } }, allPass: false };
});
