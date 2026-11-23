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
import { cliffKey, cliffLedge, laidRuns, ledgeRuns, renderPlateaus, walkCliff } from './plateauRenderer';
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
      expect(segDist(mid(pl), [0, 2], [0, 6])).toBeGreaterThan(0.5);
    }
    expect(drawn[0].filter((pl) => pl.branch === 'end')).toEqual([]);
    // The wall's rock wanders here, so the chain meets it a little aslant: a hair further off.
    for (const tip of tipsOf(walk)) expect(toRock(tip, wall)).toBeLessThan(0.35);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'cliff', closed: false });
  });

  it('lays a free-standing plateau exactly as before: one closed walk of the whole run and its closed line', () => {
    for (const extra of [{}, { mergedFloor: [room], rockLines: [wallOf(room)] }]) {
      const layer = layerOf([plat(rect(2, 2, 6, 5))], extra);
      const { laid, stretches, placed, drawn, lines } = cliffOf(layer);
      expect(stretches).toEqual([{ run: laid.run, top: laid.laid, merged: [false, false] }]);
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

  it('stops a cliff short of a painted cave’s rock, at its floor-side face', () => {
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
    for (const tip of [pts[0], pts[pts.length - 1]]) {
      // Half the rock's width back from its line, toward the floor.
      expect(toRock(tip, wall)).toBeGreaterThan(half - 0.2);
      expect(toRock(tip, wall)).toBeLessThan(half + 0.1);
      expect(pointInPoly(tip[0], tip[1], room)).toBe(true);
    }
  });
});
