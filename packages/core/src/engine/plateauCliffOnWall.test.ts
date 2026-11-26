// A plateau cliff that touches a wall: where it lies on the wall it lays no rock, top line or
// shade, the wall's rock stands for it; where it leaves the wall its rock runs on into the
// wall's, with no end piece. A cliff that touches no wall is laid as it always was.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded, load: () => Promise.resolve(loaded) };
});

import { Container, Graphics } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { layBandRing } from './caveBandRenderer';
import { cliffArt, cliffPieces } from './plateauKit';
import { cliffLineOf, cliffRockLines, rockLineOf } from './rockLines';
import { cliffFreeTips, cliffKey, cliffLedge, fittedAlongWalls, laidRuns, ledgeRuns, renderPlateaus, walkCliff } from './plateauRenderer';
import { jointsOf } from '../assets/caveWallKit';
import { bandSize } from '../assets/packCatalog';
import { layerPlateaus, pointInPoly } from '../shared/plateaus';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { WalkPlacement } from './caveWalk';
import type { DungeonLayer, PlateauChild, RockLine, ShapeChild } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

type Pt = [number, number];

const SET = 'Test_Cliff_Kit';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band };
}

/** A measured kit whose straights' rock wanders 0.2 cell either side of their joint line: the walls' and the cliffs'. */
function seedKit(): void {
  seedPack('test-cliff-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, spine: [[-0.065, 0.983], [0.135, 0.3], [-0.265, -0.3], [-0.065, -0.988]] }),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.135, 0.6], [-0.265, -0.6], [-0.065, -1.988]] }),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
  });
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function plat(ring: Pt[], height = 2): PlateauChild {
  return { id: `plat-${height}`, name: 'plat', childType: 'plateau', visible: true, contours: [ring], height, edge: 'cliff', edgeArt: SET };
}

let seq = 0;
const layerOf = (children: DungeonLayer['children'], extra: Partial<DungeonLayer> = {}) =>
  ({ id: `on-wall-${seq++}`, type: 'dungeon', children, standaloneWalls: [], mergedFloor: [], style: { wallWidth: 0.5 }, ...extra }) as unknown as DungeonLayer;

/** The line a room's rock is laid on with the kit, as the floor ring's walk saves it. */
function wallOf(ring: Pt[]): RockLine {
  const line = rockLineOf(ring, layBandRing(ring, [], cliffPieces(cliffArt(SET), SET)));
  expect(line).not.toBeNull();
  return line!;
}

/** The layer's one cliff run: its stretches, each stretch's walk and what it draws, and the cliff lines it saves. */
function cliffOf(layer: DungeonLayer) {
  const [band] = layerPlateaus(layer).bands;
  const laid = laidRuns(layer, band).find((l) => l.cliffs)!;
  const { walks, lines } = cliffRockLines(layer);
  const placed = walks.get(band)!.get(cliffKey(laid.run))!;
  return { laid, stretches: laid.cliffs!, placed, drawn: laid.cliffs!.map((c, i) => cliffLedge(c, placed[i])), lines };
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segDist(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
/** How near `p` comes to the polyline `pts`. */
const toLine = (p: readonly number[], pts: readonly (readonly number[])[]) => Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
/** How near `p` comes to a line's rock. */
const toRock = (p: readonly number[], line: RockLine) => Math.min(...line.runs.map((run) => toLine(p, run)));
const mid = (pl: WalkPlacement): Pt => [(pl.P[0] + pl.Q[0]) / 2, (pl.P[1] + pl.Q[1]) / 2];
/** A walk's two outer joints. */
const tipsOf = (walk: WalkPlacement[]) => [jointsOf(walk[0].piece, walk[0].at)[0], jointsOf(walk[walk.length - 1].piece, walk[walk.length - 1].at)[1]];
/** How far past its head (`k` 0) or tail end `p` lies along a run of `pts`, read over its last half cell: less than 0 short of it. */
function alongEnd(pts: readonly (readonly number[])[], k: number, p: readonly number[]): number {
  const run = k === 0 ? pts : [...pts].reverse();
  const end = run[0];
  const back = run.find((q) => dist(q, end) >= 0.5) ?? run[run.length - 1];
  const len = dist(end, back);
  return ((end[0] - back[0]) * (p[0] - end[0]) + (end[1] - back[1]) * (p[1] - end[1])) / len;
}

/** Everything drawn under `parent` with `label`. */
function drawnWith(parent: Container, label: string): Container[] {
  const out: Container[] = [];
  const visit = (c: Container) => {
    if (c.label === label) out.push(c);
    for (const child of c.children) visit(child as Container);
  };
  visit(parent);
  return out;
}

beforeEach(() => {
  resetAssetPackManager();
  seedKit();
});

/** The cave room and the plateau on "FA cave test 1": three of the plateau's sides lie on the room's wall. */
const caveRoom = rect(17.95, 4.03, 25.99, 11.01);
const onThreeSides = rect(21.97, 4.03, 25.99, 11.01);
const wallSides: [Pt, Pt][] = [
  [[21.97, 4.03], [25.99, 4.03]],
  [[25.99, 4.03], [25.99, 11.01]],
  [[25.99, 11.01], [21.97, 11.01]],
];

describe('a cliff with three sides on a cave room’s wall', () => {
  it('lays one open chain along the free side only, run on into the wall’s rock at both tips', () => {
    const wall = wallOf(caveRoom);
    const layer = layerOf([plat(onThreeSides)], { mergedFloor: [caveRoom], rockLines: [wall] });
    const { stretches, placed, drawn, lines } = cliffOf(layer);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].merged).toEqual([true, true]);
    const [walk] = placed;
    expect(walk.length).toBeGreaterThan(0);
    for (const pl of walk) {
      expect(Math.abs(mid(pl)[0] - 21.97)).toBeLessThan(1);
      for (const [a, b] of wallSides) expect(segDist(mid(pl), a, b)).toBeGreaterThan(0.5);
    }
    expect(ledgeRuns(walk, false)).toHaveLength(1);
    const [head, tail] = tipsOf(walk);
    expect(dist(head, tail)).toBeGreaterThan(6.5);
    expect(dist(head, tail)).toBeLessThan(8);
    expect(drawn[0].filter((pl) => pl.branch === 'end')).toEqual([]);
    expect(toRock(head, wall)).toBeLessThan(0.3);
    expect(toRock(tail, wall)).toBeLessThan(0.3);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'cliff', closed: false });
  });

  it('draws its top line along the free side only, before and after its own line is saved', () => {
    const wall = wallOf(caveRoom);
    const layer = layerOf([plat(onThreeSides)], { mergedFloor: [caveRoom], rockLines: [wall] });
    const saved = layerOf(layer.children, { mergedFloor: [caveRoom], rockLines: [wall, ...cliffOf(layer).lines] });
    for (const l of [layer, saved]) {
      const edges = new Container();
      renderPlateaus(l, new Container(), edges);
      const tops = drawnWith(edges, 'plateau-top-line');
      expect(tops).toHaveLength(1);
      // On the free side, or on the cliff's own rock beside it once that is saved: never along the wall's sides.
      const box = (tops[0] as Graphics).getLocalBounds();
      expect(box.minX).toBeGreaterThan(21.97 - 1);
      expect(box.maxX).toBeLessThan(21.97 + 0.2);
      expect(box.minY).toBeGreaterThan(4.03 - 0.5);
      expect(box.maxY).toBeLessThan(11.01 + 0.5);
      for (const p of cliffOf(l).stretches[0].top.points) expect(Math.abs(p[0] - 21.97)).toBeLessThan(0.7);
    }
  });

  it('lays the same rock a second time, along the walls’ lines and never its own', () => {
    const wall = wallOf(caveRoom);
    const layer = layerOf([plat(onThreeSides)], { mergedFloor: [caveRoom], rockLines: [wall] });
    const first = cliffOf(layer);
    const again = cliffOf(layerOf(layer.children, { mergedFloor: [caveRoom], rockLines: [wall, ...first.lines] }));
    expect(again.placed).toEqual(first.placed);
    expect(again.lines).toEqual(first.lines);
  });
});

describe('other cliffs against a wall', () => {
  const room = rect(0, 0, 10, 8);

  it('lays one chain round the free corner of a plateau tucked into a room’s corner, both tips merged', () => {
    const wall = wallOf(room);
    const layer = layerOf([plat(rect(6, 0, 10, 4))], { mergedFloor: [room], rockLines: [wall] });
    const { stretches, placed, drawn } = cliffOf(layer);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].merged).toEqual([true, true]);
    const [walk] = placed;
    expect(ledgeRuns(walk, false)).toHaveLength(1);
    for (const pl of walk) {
      expect(segDist(mid(pl), [6, 0], [10, 0])).toBeGreaterThan(0.5);
      expect(segDist(mid(pl), [10, 0], [10, 4])).toBeGreaterThan(0.5);
    }
    expect(drawn[0].filter((pl) => pl.branch === 'end')).toEqual([]);
    for (const tip of tipsOf(walk)) expect(toRock(tip, wall)).toBeLessThan(0.3);
  });

  it('lays nothing for a plateau wholly on a room’s outline: no rock, no cliff line, no top line', () => {
    const layer = layerOf([plat(room)], { mergedFloor: [room], rockLines: [wallOf(room)] });
    const { stretches, placed, lines } = cliffOf(layer);
    expect(stretches).toEqual([]);
    expect(placed).toEqual([]);
    expect(lines).toEqual([]);
    const edges = new Container();
    renderPlateaus(layer, new Container(), edges);
    for (const gone of ['plateau-cliff', 'plateau-top-line', 'plateau-cliff-ink']) expect(drawnWith(edges, gone)).toEqual([]);
  });

  it('lays a pit with one side on the wall the same way, walked the other way round', () => {
    const wall = wallOf(room);
    const pit = rect(0, 2, 4, 6);
    const layer = layerOf([plat(pit, -2)], { mergedFloor: [room], rockLines: [wall] });
    const { stretches, placed, drawn, lines } = cliffOf(layer);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].merged).toEqual([true, true]);
    const [walk] = placed;
    expect(ledgeRuns(walk, false)).toHaveLength(1);
    for (const pl of walk) {
      // A pit's low side, the walk's left, is inside it.
      const [dx, dy] = [pl.Q[0] - pl.P[0], pl.Q[1] - pl.P[1]];
      expect(dy * (2 - mid(pl)[0]) - dx * (4 - mid(pl)[1])).toBeGreaterThan(0);
      // None runs along the wall: a piece that ends on it runs off it, square to it.
      if (segDist(mid(pl), [0, 2], [0, 6]) <= 0.5) expect(Math.abs(dx)).toBeGreaterThan(5 * Math.abs(dy));
    }
    expect(drawn[0].filter((pl) => pl.branch === 'end')).toEqual([]);
    // The wall's rock wanders here, so the chain meets it a little aslant: still under the wall's rock, which is half a cell and more either side of its line.
    for (const tip of tipsOf(walk)) expect(toRock(tip, wall)).toBeLessThan(0.45);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'cliff', closed: false });
  });

  it('lays a free-standing plateau exactly as before: one closed walk of the whole run and its closed line', () => {
    for (const extra of [{}, { mergedFloor: [room], rockLines: [wallOf(room)] }]) {
      const layer = layerOf([plat(rect(2, 2, 6, 5))], extra);
      const { laid, stretches, placed, drawn, lines } = cliffOf(layer);
      expect(stretches).toEqual([{ run: laid.run, top: laid.laid, merged: [false, false], butts: [false, false], opens: [false, false] }]);
      expect(laid.walk).toBe(laid.run);
      expect(placed).toEqual([walkCliff(laid.run)]);
      expect(drawn[0]).toHaveLength(placed[0].length);
      expect(lines).toEqual([cliffLineOf(laid.run, placed[0])]);
      expect(lines[0]).toMatchObject({ kind: 'cliff', closed: true });
    }
  });

  it('cuts a cliff along a walled floor with no saved line, ending on the floor’s drawn edge', () => {
    const layer = layerOf([plat(rect(6, 0, 10, 4))], { mergedFloor: [room] });
    const { stretches, placed, drawn } = cliffOf(layer);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].merged).toEqual([true, true]);
    const pts = stretches[0].run.points;
    const ends = [pts[0], pts[pts.length - 1]].map((p) => `${p[0]},${p[1]}`).sort();
    expect(ends).toEqual(['10,4', '6,0']);
    expect(placed[0].length).toBeGreaterThan(0);
    expect(drawn[0].filter((pl) => pl.branch === 'end')).toEqual([]);
  });

  const paintedCave = (ring: Pt[] = room): ShapeChild => ({
    id: 'cave',
    name: 'cave',
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours: [ring],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    edgeMaterial: SET,
    styleOverrides: { wallTextureSetId: '' },
  });
  const even = (p: Pt, rings: Pt[][]) => rings.reduce((hit, r) => (pointInPoly(p[0], p[1], r) ? !hit : hit), false);

  // A plateau or pit running out through a painted cave's top wall (y 0): square, at 45° and at 30°.
  const square = rect(4, -1, 7, 3);
  const at45: Pt[] = [[1, -1], [5, -1], [9, 3], [5, 3]];
  const at30: Pt[] = [[1.5, -0.5], [3.5, -0.5], [3.5 + 3.5 * Math.sqrt(3), 3], [1.5 + 3.5 * Math.sqrt(3), 3]];
  const cases: [string, Pt[], number][] = [
    ['square', square, 1],
    ['at 45°', at45, 1 / Math.SQRT1_2],
    ['at 30°', at30, 2],
  ];
  for (const saved of [true, false]) {
    for (const height of [2, -1]) {
      for (const [name, ring, slant] of cases) {
        it(`runs a ${height > 0 ? 'plateau' : 'pit'}’s cliff on into a painted cave’s rock ${name}, ${saved ? 'with' : 'with no'} saved line: full width to the face, its tip in the rock`, () => {
          const wall = wallOf(room);
          const layer = layerOf([paintedCave(), plat(ring, height)], saved ? { rockLines: [wall] } : {});
          const half = 0.6 * bandSize(SET, 0.5);
          const { stretches, placed, drawn } = cliffOf(layer);
          const meeting = stretches.filter((s) => s.butts.some(Boolean));
          expect(meeting.length).toBeGreaterThan(0);
          // The rock's line: its saved line, else the cave's own outline.
          const line: RockLine = saved ? wall : { edge: room, closed: true, runs: [[...room, room[0]]] };
          for (const [i, s] of stretches.entries()) {
            const pts = s.run.points;
            const tips = [pts[0], pts[pts.length - 1]];
            for (const k of [0, 1]) {
              if (!s.butts[k]) continue;
              // Laid on to the rock's line, not stopped short of it.
              expect(toRock(tips[k], line)).toBeLessThan(0.05);
              // Narrowing only over the rock it lies on: half its width, more where it meets it aslant
              // (a saved line wanders, so its own slant there), never more than twice that.
              expect(s.reach![k]).toBeGreaterThan(half - 0.05);
              expect(s.reach![k]).toBeLessThan(2 * half + 0.05);
              if (!saved) expect(Math.abs(s.reach![k] - half * Math.min(slant, 2))).toBeLessThan(0.05);
            }
            // The walk's own tips at the rock are held to the line (bare), never run on past the rock.
            const walk = placed[i];
            if (walk.length === 0) continue;
            const taper = cliffFreeTips(s, drawn[i]);
            for (const j of tipsOf(walk)) {
              if (toRock(j, line) > 0.5) continue;
              expect(toRock(j, line)).toBeLessThan(half);
              expect(typeof taper?.(j)).toBe('number');
            }
          }
          // The top, or the pit's floor, ends at the rock: none of it on the rock's floor side of the line near a tip.
          const [band] = layerPlateaus(layer).bands;
          const top = fittedAlongWalls(band.surface, laidRuns(layer, band), undefined) as Pt[][];
          for (const s of meeting) {
            const pts = s.run.points;
            for (const k of [0, 1]) {
              if (!s.butts[k]) continue;
              const tip = (k === 0 ? pts[0] : pts[pts.length - 1]) as Pt;
              expect(even([tip[0], tip[1] + half * 0.5], top)).toBe(false);
            }
          }
        });
      }
    }
  }

  // A brushed, curved plateau or pit (48 short edges, a hair of wobble) running out through a wide
  // painted cave's top wall (y 0): a round one meeting it square, an oval one a cell past it at 45° and at 30°.
  const wide = rect(0, 0, 16, 10);
  const brushed = (deg: number): Pt[] => {
    const square = deg === 90;
    const [b, cy] = square ? [3, 0] : [3, 2];
    const a = square ? 3 : (b * Math.sqrt(1 - (cy / b) ** 2)) / ((cy / b) * Math.tan((deg * Math.PI) / 180));
    return Array.from({ length: 48 }, (_, k) => {
      const t = (2 * Math.PI * k) / 48 + 0.03;
      const w = 1 + 0.01 * Math.sin(5 * t);
      return [8 + a * w * Math.cos(t), cy + b * w * Math.sin(t)] as Pt;
    });
  };
  for (const saved of [true, false]) {
    for (const height of [2, -1]) {
      for (const [name, deg] of [['square', 90], ['at 45°', 45], ['at 30°', 30]] as [string, number][]) {
        it(`runs a curved ${height > 0 ? 'plateau' : 'pit'}’s cliff on into a painted cave’s rock ${name}, ${saved ? 'with' : 'with no'} saved line: its rock to the rock’s line, no top past it`, () => {
          const wall = wallOf(wide);
          const layer = layerOf([paintedCave(wide), plat(brushed(deg), height)], saved ? { rockLines: [wall] } : {});
          const half = 0.6 * bandSize(SET, 0.5);
          const { stretches, placed } = cliffOf(layer);
          let tips = 0;
          for (const [i, s] of stretches.entries()) {
            const walk = placed[i];
            if (walk.length === 0) continue;
            const pts = s.run.points;
            const outer = tipsOf(walk);
            for (const k of [0, 1]) {
              if (!s.butts[k]) continue;
              const tip = k === 0 ? pts[0] : pts[pts.length - 1];
              const joint = outer.reduce((b, j) => (dist(j, tip) < dist(b, tip) ? j : b));
              // The walk's own tip is level with the rock's line, along the run (a walked curve's rock sits off its
              // outline, on the low side): full width up to the rock, narrowing only over it, no stump past it.
              expect(Math.abs(alongEnd(pts, k, joint))).toBeLessThan(0.08);
              tips++;
            }
          }
          expect(tips).toBeGreaterThan(0);
          // The top, or the pit's floor, ends at the rock.
          const [band] = layerPlateaus(layer).bands;
          const top = fittedAlongWalls(band.surface, laidRuns(layer, band), undefined) as Pt[][];
          for (const s of stretches) {
            const pts = s.run.points;
            for (const k of [0, 1]) {
              if (!s.butts[k]) continue;
              const tip = (k === 0 ? pts[0] : pts[pts.length - 1]) as Pt;
              expect(even([tip[0], tip[1] + half * 0.5], top)).toBe(false);
            }
          }
        });
      }
    }
  }

  it('stops a cliff at a painted cave’s rock with its rock under the cave’s, not before it', () => {
    const cave: ShapeChild = {
      id: 'cave',
      name: 'cave',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [room],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
      edgeMaterial: SET,
    };
    const wall = wallOf(room);
    const layer = layerOf([cave, plat(rect(6, 0, 10, 4))], { rockLines: [wall] });
    const half = 0.6 * bandSize(SET, 0.5);
    const { stretches } = cliffOf(layer);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].merged).toEqual([true, true]);
    const pts = stretches[0].run.points;
    expect(stretches[0].butts).toEqual([true, true]);
    for (const tip of [pts[0], pts[pts.length - 1]]) {
      // On to the rock's line, where it lies under the cave's rock.
      expect(toRock(tip, wall)).toBeLessThan(0.05);
    }
    // Narrowing over the half of the rock it lies on, from its floor-side face.
    for (const r of stretches[0].reach!) expect(Math.abs(r - half)).toBeLessThan(0.05);
  });
});
