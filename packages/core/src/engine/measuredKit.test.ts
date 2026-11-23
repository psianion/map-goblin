// A measured band kit as drawn: its art redraws when it lands late, it is laid at its
// drawn size, its coloured cliffs are not shaded, and it has no ground strip: the floor's
// paint is fitted to its rock instead (bandFloorFit).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const late = new Texture({ source: new TextureSource({ width: 1, height: 1 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: (id: string) => (id.includes('late') ? late : loaded) };
});

import { Container, Graphics, Sprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor, jointsOf, mirrorPiece, type CaveKitPiece } from '../assets/caveWallKit';
import { bandScale, bandSetArt, bandSize } from '../assets/packCatalog';
import { resetAssetPackManager, seedCaveBandPack, seedPack } from '../testing/seedCatalog';
import {
  bandFloorFit,
  bandSeat,
  FIT_DOOR_PAD,
  fittedFloor,
  layBandRing,
  meetNeighbours,
  orientRings,
  placeBand,
  SEAT_IN,
  type FloorFit,
} from './caveBandRenderer';
import { kitOverlap, type WalkPlacement } from './caveWalk';
import { renderNodeWalls, type DoorGap } from './wallNodeRenderer';
import { renderPlateaus, shadeCliffs } from './plateauRenderer';
import { ringOpeningGaps } from '../shared/caveFloor';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { DungeonLayer, DungeonStyle, PlateauChild, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

afterEach(() => resetAssetPackManager());

const SET = 'Test_Kit';
const PACK = 'test-pack';

function entry(material: string, gridSize: string, band: BandMeasure, tags: string[]): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags, band };
}

/** Two straights, a bend of each hand and an end piece, measured on their entries; `spines` by key. */
function seedMeasuredKit(tags: string[] = [], spines: Record<string, [number, number][]> = {}): void {
  seedPack(PACK, {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, ...(spines.run_2x2 && { spine: spines.run_2x2 }) }, tags),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, ...(spines.run_2x4 && { spine: spines.run_2x4 }) }, tags),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }, tags),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }, tags),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }, tags),
  });
}

/** Even-odd containment over Clipper's rings (outers and holes alike). */
function covers(rings: Polygon[], [x, y]: [number, number]): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

function area(rings: Polygon[]): number {
  let a = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length;
      a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
    }
  }
  return Math.abs(a / 2);
}

/** The fit of one ring laid with the measured kit. */
function fitOf(poly: Polygon, gaps: DoorGap[] = []): FloorFit {
  const [ring] = orientRings([poly]);
  const placed = layBandRing(ring, gaps, bandPiecesFor(SET));
  expect(placed.length).toBeGreaterThan(0);
  return bandFloorFit(ring, placed, gaps);
}

const bandStyle = (setId: string) => ({ wallTextureSetId: setId, wallTextureTint: '#884422', wallWidth: 0.5, floorColor: '#808080' }) as DungeonStyle;
const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('band art that loads late', () => {
  it('asks for a redraw for each piece whose texture is not loaded yet', () => {
    const [ring] = orientRings([square]);
    seedMeasuredKit();
    const placed = layBandRing(ring, [], bandPiecesFor(SET));
    const art = new Map([...bandSetArt(SET)].map(([key, e]) => [key, key === 'run_2x4' ? { ...e, id: 'late-run' } : e]));
    const waitFor = vi.fn();
    placeBand(new Container(), placed, art, 0xffffff, 0, undefined, waitFor);
    expect(placed.some((pl) => pl.piece.key === 'run_2x4')).toBe(true);
    expect(waitFor).toHaveBeenCalledWith('late-run');
    expect(waitFor.mock.calls.every(([id]) => id === 'late-run')).toBe(true);
  });
});

describe('the size a band is laid at', () => {
  it('lays a measured kit at its drawn size at the default width, and the ink set as before', () => {
    seedMeasuredKit();
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
    expect(bandSize(SET, 0.5)).toBe(1);
    expect(bandSize(SET, 1)).toBe(2);
    for (const w of [0.15, 0.5, 1, 1.5]) expect(bandSize('GG_Cave_Ink', w)).toBe(bandScale(w));
  });
});

describe('coloured cliff art', () => {
  const ground: ShapeChild = {
    id: 'ground',
    name: 'ground',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [30, 0], [30, 30], [0, 30]]],
  } as ShapeChild;
  const plat = (edgeArt?: string): PlateauChild =>
    ({ id: 'top', name: 'top', childType: 'plateau', visible: true, contours: [[[5, 5], [11, 5], [11, 11], [5, 11]]], height: 2, edge: 'cliff', edgeArt }) as PlateauChild;
  const layerOf = (p: PlateauChild) => ({ id: 'l1', type: 'dungeon', children: [ground, p], style: { floorColor: '#808080' } }) as unknown as DungeonLayer;
  const rockOf = (parent: Container) =>
    ((parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container).children as Sprite[];
  const sun = { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' };

  it('keeps a coloured measured kit untinted under the sun, and shades the default ledge as before', () => {
    const object = (material: string, gridSize: string) => ({ type: 'object', material, gridSize, set: 'GG_Cave_Ink', tags: ['cave'] }) as ManifestEntry;
    seedPack('gg-forge', {
      wall_short_2x2_A: object('wall_short', '2x2'),
      inside_bend_2x2_A: object('inside_bend', '2x2'),
      outside_bend_2x2_A: object('outside_bend', '2x2'),
      rockledge_1x2_A: object('rockledge', '1x2'),
      rockledge_1x4_A: object('rockledge', '1x4'),
      rockledge_bend_90_2x2_A: object('rockledge_bend_90', '2x2'),
      rockledge_bend_n90_2x2_A: object('rockledge_bend_n90', '2x2'),
    });
    seedMeasuredKit(['colored']);

    const coloured = new Container();
    renderPlateaus(layerOf(plat(SET)), new Container(), coloured);
    shadeCliffs('l1', sun);
    expect(rockOf(coloured).length).toBeGreaterThan(0);
    expect(rockOf(coloured).every((s) => s.tint === 0xffffff)).toBe(true);

    const ledge = new Container();
    renderPlateaus(layerOf(plat()), new Container(), ledge);
    shadeCliffs('l1', sun);
    expect(rockOf(ledge).some((s) => s.tint < 0xffffff)).toBe(true);
  });
});

describe('a measured kit has no ground strip', () => {
  it('draws no strip for a measured kit and hands its ring over to be fitted', () => {
    seedMeasuredKit();
    const walls = new Container();
    const laid = vi.fn();
    renderNodeWalls(walls, [square], [], bandStyle(SET), [], {}, { onBandLaid: laid });
    expect(walls.children.length).toBeGreaterThan(0);
    expect(walls.children.some((c) => c instanceof Graphics)).toBe(false);
    expect(laid).toHaveBeenCalledTimes(1);
  });

  it('stops a ring’s rock along an opening, as at a door, in pieces of half a cell at most', () => {
    seedMeasuredKit();
    const laid = vi.fn();
    const opening: Polygon = [[4, -0.5], [5, -0.5], [5, 0.5], [4, 0.5]];
    renderNodeWalls(new Container(), [square], [], bandStyle(SET), [], {}, { onBandLaid: laid, openings: [opening] });
    const gaps: DoorGap[] = laid.mock.calls[0][0].gaps;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.ring === 0 && g.width <= 0.5 && Math.abs(g.position[1]) < 1e-9)).toBe(true);
    expect(Math.min(...gaps.map((g) => g.position[0] - g.width / 2))).toBeCloseTo(3.95, 3);
    expect(Math.max(...gaps.map((g) => g.position[0] + g.width / 2))).toBeCloseTo(5.05, 3);
  });

  it('keeps the ink set’s strip, and fits nothing for it', () => {
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
    const walls = new Container();
    const laid = vi.fn();
    renderNodeWalls(walls, [square], [], bandStyle('GG_Cave_Ink'), [], {}, { onBandLaid: laid });
    expect(walls.children[0]).toBeInstanceOf(Graphics);
    expect(laid).not.toHaveBeenCalled();
  });
});

describe('fitting the floor to a measured kit’s rock', () => {
  it('leaves a rectangle nearly as authored', () => {
    seedMeasuredKit();
    const fit = fitOf(square);
    // Next to no floor past the rock, and the ground under it filled only in a thin band
    // along the edge: out to the seat, which lies under the rock just past its floor line.
    expect(area(fit.tips)).toBeLessThan(0.5);
    const fromEdge = ([x, y]: [number, number]) => Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10));
    expect(Math.max(...[...fit.tips, ...fit.gaps].flat().map(fromEdge))).toBeLessThan(0.45);
  });

  it('fills the ground inside the rock at an L room’s reflex corner', () => {
    seedMeasuredKit();
    const fit = fitOf([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]);
    expect(covers(fit.gaps, [5.1, 5.1])).toBe(true);
    expect(covers(fit.tips, [5.1, 5.1])).toBe(false);
  });

  it('takes the floor off past the rock at a corner sharper than a right angle', () => {
    seedMeasuredKit();
    const fit = fitOf([[0, 0], [8, 1], [11, 6], [6, 9], [1, 7]]);
    // Just inside the tip at [0, 0], along its bisector.
    expect(covers(fit.tips, [0.06, 0.05])).toBe(true);
  });

  it('cuts and adds nothing inside a door opening', () => {
    seedMeasuredKit();
    const door: DoorGap = { wallId: 'floor:0:0', position: [5, 0], width: 1, ring: 0 };
    const fit = fitOf(square, [door]);
    const clear = door.width / 2 + FIT_DOOR_PAD - 0.02;
    for (const p of [...fit.tips, ...fit.gaps].flat()) {
      expect(Math.hypot(p[0] - door.position[0], p[1] - door.position[1])).toBeGreaterThanOrEqual(clear);
    }
  });

  it('fits nothing for a ring the walk laid nothing for', () => {
    expect(bandFloorFit(square, [])).toEqual({ tips: [], gaps: [] });
  });
});

describe('a piece that carries its rock’s spine', () => {
  // Each straight's rock humps 0.8 cell to the floor side (+x) of its joint line, off its
  // middle: past the authored edge, which lies about 0.36 in from the joints.
  const HUMP: Record<string, [number, number]> = { run_2x2: [0.735, 0.25], run_2x4: [0.735, 0.5] };
  const SPINES: Record<string, [number, number][]> = {
    run_2x2: [[-0.065, 0.983], HUMP.run_2x2, [-0.065, -0.988]],
    run_2x4: [[-0.065, 1.983], HUMP.run_2x4, [-0.065, -1.988]],
  };

  it('is carried onto the kit piece, and mirrored with it', () => {
    seedMeasuredKit([], SPINES);
    const pool = bandPiecesFor(SET);
    const run = pool.find((p) => p.key === 'run_2x2' && !p.flipY)!;
    expect(run.spine).toEqual(SPINES.run_2x2);
    const mirrored = [[-0.065, 0.988], [0.735, -0.25], [-0.065, -0.983]];
    expect(mirrorPiece(run).spine).toEqual(mirrored);
    expect(pool.find((p) => p.key === 'run_2x2' && p.flipY)!.spine).toEqual(mirrored);
    expect(pool.find((p) => p.key === 'turn_in_2x2')!.spine).toBeUndefined();
  });

  /** Distance from `p` to the nearest edge of any ring. */
  function toBoundary(rings: Polygon[], p: [number, number]): number {
    let best = Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const d = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)));
        best = Math.min(best, Math.hypot(a[0] + d[0] * t - p[0], a[1] + d[1] * t - p[1]));
      }
    }
    return best;
  }

  it('seats the floor on the rock’s own line, and the kit without it as before', () => {
    const [ring] = orientRings([square]);
    seedMeasuredKit([], SPINES);
    const placed = layBandRing(ring, [], bandPiecesFor(SET));
    const seat = bandSeat(placed);
    const floor = fittedFloor([ring], bandFloorFit(ring, placed));
    const corners = square.map(([x, y]) => [x, y] as [number, number]);

    // Each straight's hump where its sprite draws it (y negated for a mirrored one), and a
    // point halfway from there to where the joint-line seat ran.
    const probes = placed.flatMap((pl) => {
      const q = HUMP[pl.piece.key];
      if (!q) return [];
      const y = pl.at.flipY ? -q[1] : q[1];
      const c = Math.cos(pl.at.rotation);
      const s = Math.sin(pl.at.rotation);
      const hump: [number, number] = [pl.at.position.x + (q[0] * c - y * s) * pl.at.scale, pl.at.position.y + (q[0] * s + y * c) * pl.at.scale];
      if (corners.some(([x, cy]) => Math.hypot(x - hump[0], cy - hump[1]) < 1.5)) return [];
      const [J0, J1] = jointsOf(pl.piece, pl.at);
      const v = [J1[0] - J0[0], J1[1] - J0[1]];
      const L2 = v[0] ** 2 + v[1] ** 2;
      const t = ((hump[0] - J0[0]) * v[0] + (hump[1] - J0[1]) * v[1]) / L2;
      const right = [-v[1] / Math.sqrt(L2), v[0] / Math.sqrt(L2)];
      const old = [J0[0] + v[0] * t + right[0] * SEAT_IN * pl.at.scale, J0[1] + v[1] * t + right[1] * SEAT_IN * pl.at.scale];
      return [{ pl, hump, between: [(hump[0] + old[0]) / 2, (hump[1] + old[1]) / 2] as [number, number] }];
    });
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.some((p) => p.pl.at.flipY)).toBe(true);
    for (const { hump, between } of probes) {
      expect(toBoundary(seat, hump)).toBeLessThan(0.01);
      expect(covers([ring], between)).toBe(true);
      expect(covers(floor, between)).toBe(false);
    }

    resetAssetPackManager();
    seedMeasuredKit();
    const plain = layBandRing(ring, [], bandPiecesFor(SET));
    const plainFloor = fittedFloor([ring], bandFloorFit(ring, plain));
    for (const { between } of probes) expect(covers(plainFloor, between)).toBe(true);
  });
});

describe('a kit measured to butt', () => {
  /** Straights of 1, 2, 5 and 8 cells and a 2x2 bend, each joint 0.15 cell past its tile's end. */
  function seedButtKit(): void {
    const run = (cells: number) => entry('run', `2x${cells}`, { joints: [[0, cells / 2 + 0.15], [0, -cells / 2 - 0.15]], turnDeg: 0 }, []);
    seedPack(PACK, {
      run_2x1_A: run(1),
      run_2x2_A: run(2),
      run_2x5_A: run(5),
      run_2x8_A: run(8),
      turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.5, 1.15], [1.15, -0.5]], turnDeg: 90 }, []),
    });
  }
  const room: Polygon = [[2.5, 2.5], [13, 2.5], [13, 10.5], [2.5, 10.5]];
  const sixSided: Polygon = [[18, 3], [23.5, 2], [27.5, 6], [26, 12], [21.5, 14.5], [16.5, 10.5]];
  const withoutExact = (set: CaveKitPiece[]): CaveKitPiece[] => set.map((p) => ({ ...p, exact: undefined }));

  /** How far each piece's laid end runs past the next one's laid start, along travel there. */
  function laps(placed: WalkPlacement[], ring: boolean): number[] {
    return placed.slice(0, ring ? placed.length : -1).map((a, k) => {
      const b = placed[(k + 1) % placed.length];
      const [, end] = jointsOf(a.piece, a.at);
      const [start] = jointsOf(b.piece, b.at);
      const exit = Math.atan2(a.Q[1] - a.P[1], a.Q[0] - a.P[0]) + (a.piece.turnDeg * Math.PI) / 360;
      return (end[0] - start[0]) * Math.cos(exit) + (end[1] - start[1]) * Math.sin(exit);
    });
  }

  /**
   * Each joint's lap in full: the kit's overlap, or less where the pieces either side are laid
   * smaller, half the overlap at each one's own scale, where the art either side just meets.
   */
  function fullLaps(placed: WalkPlacement[], set: CaveKitPiece[], ring: boolean): number[] {
    const overlap = kitOverlap(set);
    return placed.slice(0, ring ? placed.length : -1).map((a, k) => Math.min(overlap, (overlap / 2) * (a.at.scale + placed[(k + 1) % placed.length].at.scale)));
  }

  /** Every joint laps in full (see {@link fullLaps}). */
  const lapsInFull = (placed: WalkPlacement[], set: CaveKitPiece[], ring = false): void => {
    const full = fullLaps(placed, set, ring);
    laps(placed, ring).forEach((lap, k) => expect(lap).toBeGreaterThanOrEqual(full[k] - 0.01));
  };

  for (const [name, poly] of [['a 10.5 by 8 room', room], ['a six-sided room', sixSided]] as const) {
    it(`laps every joint round ${name} in full, stretching no piece past 1.25`, () => {
      seedButtKit();
      const set = bandPiecesFor(SET);
      expect(set.every((p) => p.exact)).toBe(true);
      const [ring] = orientRings([poly]);
      const placed = layBandRing(ring, [], set);
      expect(placed.length).toBeGreaterThan(4);
      lapsInFull(placed, set, true);
      for (const pl of placed) expect(pl.at.scale).toBeLessThanOrEqual(1.25);
    });
  }

  /** Where the art stops at a run's two ends: half the kit's overlap in from its end joints. */
  function artEnds(placed: WalkPlacement[], set: CaveKitPiece[]): [[number, number], [number, number]] {
    const half = kitOverlap(set) / 2;
    const a = placed[0];
    const b = placed[placed.length - 1];
    const along = (pl: WalkPlacement) => {
      const L = Math.hypot(pl.Q[0] - pl.P[0], pl.Q[1] - pl.P[1]);
      return [(pl.Q[0] - pl.P[0]) / L, (pl.Q[1] - pl.P[1]) / L];
    };
    const [start] = jointsOf(a.piece, a.at);
    const [, end] = jointsOf(b.piece, b.at);
    const ta = along(a);
    const tb = along(b);
    return [
      [start[0] + ta[0] * half, start[1] + ta[1] * half],
      [end[0] - tb[0] * half, end[1] - tb[1] * half],
    ];
  }

  /**
   * One run round the ring whose art ends within 0.1 of `edges` (x along a top edge), its two
   * end pieces within 0.8 to 1.25 of their drawn size.
   */
  function expectToOpening(placed: WalkPlacement[], set: CaveKitPiece[], edges: [number, number]): void {
    expect(placed.length).toBeGreaterThan(2);
    const xs = artEnds(placed, set).map(([x]) => x).sort((p, q) => p - q);
    expect(Math.abs(xs[0] - edges[0])).toBeLessThan(0.1);
    expect(Math.abs(xs[1] - edges[1])).toBeLessThan(0.1);
    for (const pl of [placed[0], placed[placed.length - 1]]) {
      expect(pl.at.scale).toBeGreaterThanOrEqual(0.8);
      expect(pl.at.scale).toBeLessThanOrEqual(1.25);
    }
  }

  it('runs the rock either side of a door to the door’s edges and leaves the door open', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([room]);
    const door: DoorGap = { wallId: 'floor:0:0', position: [7.75, 2.5], width: 1.5, ring: 0 };
    const placed = layBandRing(ring, [door], set);
    // One opening: one run round the ring, from one side of the door to the other.
    expectToOpening(placed, set, [7, 8.5]);
    const [a, b] = artEnds(placed, set);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(door.width - 0.1);
  });

  const mouthRoom: Polygon = [[6, 6], [24, 6], [24, 21], [6, 21]];
  /** The mouth room's ring and gaps with a 1 cell erase across its top edge at x 14 to 15. */
  function erasedMouth(): { ring: Polygon; gaps: DoorGap[] } {
    const laid = vi.fn();
    const opening: Polygon = [[14, 5.5], [15, 5.5], [15, 6.5], [14, 6.5]];
    renderNodeWalls(new Container(), [mouthRoom], [], bandStyle(SET), [], {}, { onBandLaid: laid, openings: [opening] });
    const { ring, gaps } = laid.mock.calls[0][0];
    return { ring, gaps };
  }

  it('runs the rock to the two edges of an opening erased across a room’s edge', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const { ring, gaps } = erasedMouth();
    expect(gaps.length).toBeGreaterThan(1);
    const placed = layBandRing(ring, gaps, set);
    expectToOpening(placed, set, [14, 15]);
    lapsInFull(placed, set);
  });

  it('runs the rock to the edges of the notched ring an erase really leaves', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([[[24, 21], [6, 21], [6, 6], [14, 6], [14, 7], [15, 7], [15, 6], [24, 6]]]);
    const gaps = ringOpeningGaps(ring, 0, [[[15, 7], [14, 7], [14, 5], [15, 5]]]);
    expect(gaps.length).toBeGreaterThan(4);
    const placed = layBandRing(ring, gaps, set);
    const xs = artEnds(placed, set).map(([x]) => x).sort((p, q) => p - q);
    expect(Math.abs(xs[0] - 13.95)).toBeLessThan(0.05);
    expect(Math.abs(xs[1] - 15.05)).toBeLessThan(0.05);
  });

  it('runs the rock to a door’s two edges on the same room', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([mouthRoom]);
    const door: DoorGap = { wallId: 'floor:0:0', position: [14.5, 6], width: 1.5, ring: 0 };
    const placed = layBandRing(ring, [door], set);
    expectToOpening(placed, set, [13.75, 15.25]);
    lapsInFull(placed, set);
  });

  it('lays the same kit without `exact` beside an opening as before', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const { ring, gaps } = erasedMouth();
    const placed = layBandRing(ring, gaps, withoutExact(set));
    // As laid before a measured kit's rock was run to the opening: stopped short of it.
    expect(placed.map((pl) => pl.piece.key + (pl.piece.flipY ? '~' : ''))).toEqual(
      ['run_2x8~', 'turn_in_2x2', 'run_2x8~', 'run_2x5~', 'turn_in_2x2', 'run_2x8~', 'run_2x5~', 'run_2x2~', 'turn_in_2x2', 'run_2x8~', 'run_2x5~', 'run_2x1', 'run_2x8'],
    );
    expect(placed[0].P[0]).toBeCloseTo(15.320404, 6);
    expect(placed[0].P[1]).toBeCloseTo(5.82, 6);
    expect(placed[placed.length - 1].Q[0]).toBeCloseTo(13.622017, 6);
    expect(placed[placed.length - 1].Q[1]).toBeCloseTo(5.82, 6);
  });

  it('lays the same kit without `exact` as the walk answers, short joints and all', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const plain = withoutExact(set);
    const [ring] = orientRings([room]);
    const placed = layBandRing(ring, [], plain);
    expect(meetNeighbours(placed, plain, true)).toBe(placed);
    expect(laps(placed, true).some((lap) => lap < kitOverlap(plain) - 0.1)).toBe(true);
    // The exact kit is laid bend by bend instead (layExactRing).
    expect(layBandRing(ring, [], set).map((pl) => pl.piece.key)).toEqual(
      ['turn_in_2x2', 'run_2x8', 'turn_in_2x2', 'run_2x1', 'run_2x5', 'turn_in_2x2', 'run_2x8', 'turn_in_2x2', 'run_2x1', 'run_2x5'],
    );
  });

  const notched: Polygon = [[24, 21], [6, 21], [6, 6], [14, 6], [14, 7], [15, 7], [15, 6], [24, 6]];
  const notchGaps = (ring: Polygon): DoorGap[] => ringOpeningGaps(ring, 0, [[[15, 7], [14, 7], [14, 5], [15, 5]]]);

  it('lays no piece squashed on the notched ring an erase leaves, still lapping and reaching the mouth', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([notched]);
    const placed = layBandRing(ring, notchGaps(ring), set);
    for (const pl of placed) expect(pl.at.scale).toBeGreaterThanOrEqual(0.9);
    lapsInFull(placed, set);
    const xs = artEnds(placed, set).map(([x]) => x).sort((p, q) => p - q);
    expect(Math.abs(xs[0] - 13.95)).toBeLessThan(0.05);
    expect(Math.abs(xs[1] - 15.05)).toBeLessThan(0.05);
  });

  it('lays no piece squashed round a 10.5 by 8 room', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([room]);
    const placed = layBandRing(ring, [], set);
    for (const pl of placed) expect(pl.at.scale).toBeGreaterThanOrEqual(0.9);
    lapsInFull(placed, set, true);
  });

  it('leaves the same kit without `exact` squashed where the walk closes it, as before', () => {
    seedButtKit();
    const plain = withoutExact(bandPiecesFor(SET));
    const [notchRing] = orientRings([notched]);
    const [roomRing] = orientRings([room]);
    const door: DoorGap = { wallId: 'floor:0:0', position: [7.75, 2.5], width: 1.5, ring: 0 };
    const cases = [
      {
        placed: layBandRing(notchRing, notchGaps(notchRing), plain),
        scales: [1, 0.999988, 1, 1, 1, 0.999951, 1, 1, 0.999981, 1, 1, 1, 0.999945, 1.434783, 1.477537],
        ends: [[15.406532, 5.857944], [13.629776, 5.860769]],
      },
      {
        placed: layBandRing(roomRing, [door], plain),
        scales: [1, 0.999899, 0.999999, 1, 0.999953, 1, 0.99995, 1, 1.147399, 0.810023],
        ends: [[8.823251, 2.32], [6.725243, 2.32]],
      },
    ];
    for (const { placed, scales, ends } of cases) {
      expect(placed).toHaveLength(scales.length);
      placed.forEach((pl, k) => expect(pl.at.scale).toBeCloseTo(scales[k], 5));
      const [p, q] = [placed[0].P, placed[placed.length - 1].Q];
      for (const [got, want] of [[p, ends[0]], [q, ends[1]]]) {
        expect(got[0]).toBeCloseTo(want[0], 5);
        expect(got[1]).toBeCloseTo(want[1], 5);
      }
    }
  });

  /** The lap each joint asks for: the kit's overlap plus up to 0.3 for the turn there. */
  function wanted(placed: WalkPlacement[], set: CaveKitPiece[], ring: boolean): number[] {
    const travel = (pl: WalkPlacement, half: number) =>
      Math.atan2(pl.Q[1] - pl.P[1], pl.Q[0] - pl.P[0]) + (half * pl.piece.turnDeg * Math.PI) / 360;
    return placed.slice(0, ring ? placed.length : -1).map((a, k) => {
      const d = travel(placed[(k + 1) % placed.length], -1) - travel(a, 1);
      const turn = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      return kitOverlap(set) + Math.min(0.3, 0.3 * Math.tan(turn / 2));
    });
  }

  /** Every joint laps in full and no more than 0.3 over what it asks for; every piece 0.8 to 1.3 of its size. */
  function expectSnugLaps(placed: WalkPlacement[], set: CaveKitPiece[], ring: boolean): void {
    const want = wanted(placed, set, ring);
    lapsInFull(placed, set, ring);
    laps(placed, ring).forEach((lap, k) => expect(lap).toBeLessThanOrEqual(want[k] + 0.3));
    for (const pl of placed) {
      expect(pl.at.scale).toBeGreaterThanOrEqual(0.8);
      expect(pl.at.scale).toBeLessThanOrEqual(1.3);
    }
  }

  // A 10 by 10 room with the same notch: its closing straight is laid from under the corner bend before it.
  const notched10: Polygon = [[21, 16], [11, 16], [11, 6], [14, 6], [14, 7], [15, 7], [15, 6], [21, 6]];

  for (const [name, poly] of [['the notched ring an erase leaves', notched], ['a 10 by 10 notched ring', notched10]] as const) {
    it(`runs no straight on past the piece it meets round ${name}, still reaching the mouth`, () => {
      seedButtKit();
      const set = bandPiecesFor(SET);
      const [ring] = orientRings([poly]);
      const placed = layBandRing(ring, notchGaps(ring), set);
      expectSnugLaps(placed, set, false);
      const xs = artEnds(placed, set).map(([x]) => x).sort((p, q) => p - q);
      expect(Math.abs(xs[0] - 13.95)).toBeLessThan(0.05);
      expect(Math.abs(xs[1] - 15.05)).toBeLessThan(0.05);
    });
  }

  // A 14.5 by 7.5 room: an 8-cell straight on its top side runs half a cell on under the closing piece.
  const longRoom: Polygon = [[2.5, 2.5], [17, 2.5], [17, 10], [2.5, 10]];

  for (const [name, poly] of [['a 10.5 by 8 room', room], ['a 14.5 by 7.5 room', longRoom]] as const) {
    it(`runs no straight on past the piece it meets round ${name}`, () => {
      seedButtKit();
      const set = bandPiecesFor(SET);
      const [ring] = orientRings([poly]);
      expectSnugLaps(layBandRing(ring, [], set), set, true);
    });
  }

  it('lays the same kit without `exact` on the 10 by 10 notched ring as before', () => {
    seedButtKit();
    const plain = withoutExact(bandPiecesFor(SET));
    const [ring] = orientRings([notched10]);
    const placed = layBandRing(ring, notchGaps(ring), plain);
    expect(placed.map((pl) => pl.piece.key + (pl.piece.flipY ? '~' : ''))).toEqual(
      ['run_2x5', 'turn_in_2x2', 'run_2x5~', 'run_2x2~', 'turn_in_2x2', 'run_2x8', 'turn_in_2x2', 'run_2x5~', 'run_2x2', 'run_2x2'],
    );
    const scales = [0.999999, 0.999982, 1, 1, 0.999935, 1, 0.999983, 1, 1.479775, 1.199938];
    placed.forEach((pl, k) => expect(pl.at.scale).toBeCloseTo(scales[k], 5));
    expect(placed[0].P[0]).toBeCloseTo(15.421849, 5);
    expect(placed[0].P[1]).toBeCloseTo(5.855895, 5);
    expect(placed[placed.length - 1].Q[0]).toBeCloseTo(13.63291, 5);
    expect(placed[placed.length - 1].Q[1]).toBeCloseTo(5.86641, 5);
  });

  /** How much of any piece's art along the top edge lies inside the x 14 to 15 mouth, 0.05 in from its edges. */
  function artInMouth(placed: WalkPlacement[], set: CaveKitPiece[]): number {
    const half = kitOverlap(set) / 2;
    return Math.max(0, ...placed.map((pl) => {
      const [a, b] = jointsOf(pl.piece, pl.at);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u = a[0] + ((b[0] - a[0]) / L) * half;
      const v = b[0] - ((b[0] - a[0]) / L) * half;
      if (Math.abs(a[1] - 6) > 1 || Math.abs(b[1] - 6) > 1) return 0;
      return Math.min(Math.max(u, v), 15) - Math.max(Math.min(u, v), 14);
    }));
  }

  it('leaves the mouth of a 16 by 11 notched ring open, its rock run to both edges', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const [ring] = orientRings([[[22, 17], [6, 17], [6, 6], [14, 6], [14, 7], [15, 7], [15, 6], [22, 6]]]);
    const placed = layBandRing(ring, notchGaps(ring), set);
    expect(artInMouth(placed, set)).toBe(0);
    const xs = artEnds(placed, set).map(([x]) => x).sort((p, q) => p - q);
    expect(Math.abs(xs[0] - 13.95)).toBeLessThan(0.1);
    expect(Math.abs(xs[1] - 15.05)).toBeLessThan(0.1);
  });

  it('lays no rock inside the mouth of any notched ring from 6 to 26 cells wide and 5 to 18 deep', () => {
    seedButtKit();
    const set = bandPiecesFor(SET);
    const closed: string[] = [];
    for (let x0 = 2; x0 <= 11; x0++) {
      for (let x1 = 17; x1 <= 28; x1++) {
        for (let y1 = 11; y1 <= 24; y1++) {
          const [ring] = orientRings([[[x1, y1], [x0, y1], [x0, 6], [14, 6], [14, 7], [15, 7], [15, 6], [x1, 6]]]);
          if (artInMouth(layBandRing(ring, notchGaps(ring), set), set) > 0) closed.push(`${x0},${x1},${y1}`);
        }
      }
    }
    expect(closed).toEqual([]);
  });
});

describe('a measured kit on a straight-sided room, laid corner by corner', () => {
  /** Straights of 1, 2, 5 and 8 cells and a 2x2 bend of each hand, each joint 0.15 cell past its tile's end. */
  function seedKit(): CaveKitPiece[] {
    const run = (cells: number) => entry('run', `2x${cells}`, { joints: [[0, cells / 2 + 0.15], [0, -cells / 2 - 0.15]], turnDeg: 0 }, []);
    seedPack(PACK, {
      run_2x1_A: run(1),
      run_2x2_A: run(2),
      run_2x5_A: run(5),
      run_2x8_A: run(8),
      turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.5, 1.15], [1.15, -0.5]], turnDeg: 90 }, []),
      turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[0.5, 1.15], [-1.15, -0.5]], turnDeg: -90 }, []),
    });
    return bandPiecesFor(SET);
  }
  type V = [number, number];
  const unit = (a: V, b: V): V => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const dotV = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
  const crossV = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
  const minus = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];

  /** A piece's travel where its art starts and ends, and the two points its art ends at: half an overlap in from its joints. */
  function art(pl: WalkPlacement, set: CaveKitPiece[]): { start: V; end: V; tin: V; tout: V } {
    const half = kitOverlap(set) / 2;
    const chord = Math.atan2(pl.Q[1] - pl.P[1], pl.Q[0] - pl.P[0]);
    const turn = (pl.piece.turnDeg * Math.PI) / 360;
    const tin: V = [Math.cos(chord - turn), Math.sin(chord - turn)];
    const tout: V = [Math.cos(chord + turn), Math.sin(chord + turn)];
    const [J0, J1] = jointsOf(pl.piece, pl.at);
    const k = half * pl.at.scale;
    return { start: [J0[0] + tin[0] * k, J0[1] + tin[1] * k], end: [J1[0] - tout[0] * k, J1[1] - tout[1] * k], tin, tout };
  }

  /** The art's midline: a straight's from end to end, a bend's along both arms through where they meet. */
  function artLine(pl: WalkPlacement, set: CaveKitPiece[]): V[] {
    const { start, end, tin, tout } = art(pl, set);
    if (pl.piece.turnDeg === 0) return [start, end];
    const s = crossV(minus(end, start), tout) / crossV(tin, tout);
    return [start, [start[0] + tin[0] * s, start[1] + tin[1] * s], end];
  }

  /** Each corner of a ring, with its signed turn, the ring wound void-left. */
  function cornersOf(ring: Polygon): { p: V; turn: number }[] {
    return ring.flatMap((p, k) => {
      const a = unit(ring[(k - 1 + ring.length) % ring.length] as V, p as V);
      const b = unit(p as V, ring[(k + 1) % ring.length] as V);
      const turn = (Math.atan2(crossV(a, b), dotV(a, b)) * 180) / Math.PI;
      return Math.abs(turn) < 5 ? [] : [{ p: p as V, turn }];
    });
  }

  /**
   * What is wrong with a ring laid corner by corner, by assertion: `corners` (the ring as
   * bridged, wound void-left) each wants a bend at scale 1 (`missing`), and no bend may turn
   * against its corner or be laid at another size (`wrong`); `opening` (its two wall ends,
   * when there is one) wants no art inside it and a run end within 0.02 of each wall end;
   * every joint between neighbours wants its art to meet within 0.02, and where a bend meets
   * a straight their joints in line within 0.02 across travel (`side`); every straight wants
   * a scale inside 0.85 to 1.2 and to run along a side (`angle`).
   */
  function faults(placed: WalkPlacement[], set: CaveKitPiece[], corners: Polygon, opening?: [V, V]): Record<string, number> {
    const out = { missing: 0, wrong: 0, opening: 0, ends: 0, meet: 0, side: 0, scale: 0, angle: 0, worstMeet: 0, worstSide: 0, worstScale: 1 };
    const bends = placed.filter((pl) => pl.piece.turnDeg !== 0);
    const cs = cornersOf(corners);
    const mid = (pl: WalkPlacement): V => [(pl.P[0] + pl.Q[0]) / 2, (pl.P[1] + pl.Q[1]) / 2];
    const near = (pl: WalkPlacement) => cs.reduce((a, c) => (Math.hypot(mid(pl)[0] - c.p[0], mid(pl)[1] - c.p[1]) < Math.hypot(mid(pl)[0] - a.p[0], mid(pl)[1] - a.p[1]) ? c : a));
    for (const pl of bends) if (Math.sign(pl.piece.turnDeg) !== Math.sign(near(pl).turn) || Math.abs(pl.at.scale - 1) >= 0.01) out.wrong++;
    for (const c of cs) if (!bends.some((pl) => near(pl) === c && Math.hypot(mid(pl)[0] - c.p[0], mid(pl)[1] - c.p[1]) < 1.5)) out.missing++;
    if (opening) {
      const [A, B] = opening;
      const u = unit(A, B);
      const w = Math.hypot(B[0] - A[0], B[1] - A[1]);
      for (const pl of placed) {
        const line = artLine(pl, set);
        for (let i = 0; i + 1 < line.length; i++) {
          const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
          for (let s = 0; s <= L; s += 0.01) {
            const p: V = [line[i][0] + ((line[i + 1][0] - line[i][0]) * s) / L, line[i][1] + ((line[i + 1][1] - line[i][1]) * s) / L];
            const t = dotV(minus(p, A), u);
            if (Math.abs(crossV(minus(p, A), u)) <= 1 && t > 0.02 && t < w - 0.02) {
              out.opening++;
              s = L;
            }
          }
        }
      }
      // One run, from the opening's far side round to its near side.
      const first = art(placed[0], set);
      const last = art(placed[placed.length - 1], set);
      const off = [Math.abs(dotV(minus(first.start, B), first.tin)), Math.abs(dotV(minus(last.end, A), last.tout))];
      out.ends += off.filter((d) => d > 0.02).length;
    }
    placed.slice(0, opening ? -1 : placed.length).forEach((a, k) => {
      const b = placed[(k + 1) % placed.length];
      const t = a.piece.turnDeg === 0 ? art(a, set).tout : art(b, set).tin;
      const gap = dotV(minus(art(b, set).start, art(a, set).end), t);
      out.worstMeet = Math.max(out.worstMeet, Math.abs(gap));
      if (Math.abs(gap) > 0.02) out.meet++;
      // A bend and a straight: their two joints in line across travel.
      if ((a.piece.turnDeg === 0) !== (b.piece.turnDeg === 0)) {
        const across = Math.abs(crossV(minus(jointsOf(b.piece, b.at)[0], jointsOf(a.piece, a.at)[1]), t));
        out.worstSide = Math.max(out.worstSide, across);
        if (across > 0.02) out.side++;
      }
    });
    const sides = corners.map((p, k) => unit(p as V, corners[(k + 1) % corners.length] as V));
    for (const pl of placed.filter((q) => q.piece.turnDeg === 0)) {
      if (Math.abs(pl.at.scale - 1) > Math.abs(out.worstScale - 1)) out.worstScale = pl.at.scale;
      if (pl.at.scale < 0.85 || pl.at.scale > 1.2) out.scale++;
      if (!sides.some((u) => dotV(u, unit(pl.P, pl.Q)) > Math.cos((0.5 * Math.PI) / 180))) out.angle++;
    }
    return out;
  }

  const ASSERTIONS = ['missing', 'wrong', 'opening', 'ends', 'meet', 'side', 'scale', 'angle'];
  const expectClean = (f: Record<string, number>) => expect(ASSERTIONS.map((k) => f[k])).toEqual(ASSERTIONS.map(() => 0));
  const notchAt = (x: number): Polygon => [[x + 1, 7], [x, 7], [x, 5], [x + 1, 5]];
  const room: Polygon = [[2.5, 2.5], [13, 2.5], [13, 10.5], [2.5, 10.5]];
  const pinned: { name: string; poly: Polygon; corners: Polygon; gaps: (ring: Polygon) => DoorGap[]; opening?: [V, V] }[] = [
    {
      name: 'the 18 by 15 notched room',
      poly: [[24, 21], [6, 21], [6, 6], [14, 6], [14, 7], [15, 7], [15, 6], [24, 6]],
      corners: [[6, 6], [24, 6], [24, 21], [6, 21]],
      gaps: (ring) => ringOpeningGaps(ring, 0, [notchAt(14)]),
      opening: [[13.95, 6], [15.05, 6]],
    },
    {
      name: 'the 16 by 11 notched room',
      poly: [[22, 17], [6, 17], [6, 6], [14, 6], [14, 7], [15, 7], [15, 6], [22, 6]],
      corners: [[6, 6], [22, 6], [22, 17], [6, 17]],
      gaps: (ring) => ringOpeningGaps(ring, 0, [notchAt(14)]),
      opening: [[13.95, 6], [15.05, 6]],
    },
    { name: 'a 10.5 by 8 room', poly: room, corners: room, gaps: () => [] },
    { name: 'an L-shaped room', poly: [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]], corners: [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]], gaps: () => [] },
    {
      name: 'a 10.5 by 8 room with a door on its top side',
      poly: room,
      corners: room,
      gaps: () => [{ wallId: 'floor:0:0', position: [7.75, 2.5], width: 1.5, ring: 0 }],
      opening: [[7, 2.5], [8.5, 2.5]],
    },
  ];

  for (const { name, poly, corners, gaps, opening } of pinned) {
    it(`lays ${name} bend by bend, its straights fitted between`, () => {
      const set = seedKit();
      const [ring] = orientRings([poly]);
      const [bridged] = orientRings([corners]);
      const placed = layBandRing(ring, gaps(ring), set);
      expectClean(faults(placed, set, bridged, opening));
    });
  }

  it('lays every rectangle from 4 to 20 cells a side, plain and notched, bend by bend', () => {
    const set = seedKit();
    const failed: { room: string; f: Record<string, number> }[] = [];
    let rooms = 0;
    let plainFailed = 0;
    for (let w = 4; w <= 20; w += 0.5) {
      for (let h = 4; h <= 20; h += 0.5) {
        const rect: Polygon = [[0, 0], [w, 0], [w, h], [0, h]];
        const [plain] = orientRings([rect]);
        const cases: { ring: Polygon; gaps: DoorGap[]; opening?: [V, V]; label: string }[] = [{ ring: plain, gaps: [], label: `${w}x${h}` }];
        // A quarter, a half and three quarters along the top, on whole cells and a cell from either corner at least.
        for (const x of [w / 4, w / 2, (3 * w) / 4].map((t) => Math.min(Math.max(Math.round(t - 0.5), 1), Math.floor(w - 2)))) {
          const [ring] = orientRings([[[w, h], [0, h], [0, 0], [x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [w, 0]]]);
          cases.push({ ring, gaps: ringOpeningGaps(ring, 0, [[[x + 1, 1], [x, 1], [x, -1], [x + 1, -1]]]), opening: [[x - 0.05, 0], [x + 1.05, 0]], label: `${w}x${h} notch ${x}` });
        }
        for (const c of cases) {
          rooms++;
          const f = faults(layBandRing(c.ring, c.gaps, set), set, plain, c.opening);
          if (ASSERTIONS.some((k) => f[k] > 0)) {
            failed.push({ room: c.label, f });
            if (!c.opening) plainFailed++;
          }
        }
      }
    }
    expect(rooms).toBe(4356);
    // No bend the wrong way, no art in a mouth, no run short of one, no step across a bend's
    // joint, no straight at an angle, and every plain rectangle clean. What fails is beside a
    // notch, where whole-cell straights cannot fit: a stretch of 1.2 to 1.7 or 2.4 to 2.55
    // cells goes outside 0.85 to 1.2, one under 0.6 is held at 0.6 and laps its bend by up to
    // 0.29, and a notch a cell from a corner takes that corner's bend.
    expect(Object.fromEntries(ASSERTIONS.map((k) => [k, failed.filter((x) => x.f[k] > 0).length]))).toEqual({
      missing: 462,
      wrong: 0,
      opening: 0,
      ends: 0,
      meet: 231,
      side: 0,
      scale: 1353,
      angle: 0,
    });
    expect([failed.length, plainFailed]).toEqual([1353, 0]);
    expect(Math.min(...failed.map((x) => x.f.worstScale))).toBeCloseTo(0.6, 6);
    expect(Math.max(...failed.map((x) => x.f.worstScale))).toBeCloseTo(1.31, 6);
    expect(Math.max(...failed.map((x) => x.f.worstMeet))).toBeLessThan(0.3);
    expect(Math.max(...failed.map((x) => x.f.worstSide))).toBeLessThan(1e-9);
  }, 30_000);

  it('leaves a six-sided room to the walk, as before', () => {
    const set = seedKit();
    const [ring] = orientRings([[[18, 3], [23.5, 2], [27.5, 6], [26, 12], [21.5, 14.5], [16.5, 10.5]]]);
    const placed = layBandRing(ring, [], set);
    expect(placed.map((pl) => pl.piece.key + (pl.piece.flipY ? '~' : ''))).toEqual(
      ['run_2x2', 'turn_in_2x2', 'run_2x2~', 'run_2x2~', 'run_2x1', 'run_2x2~', 'run_2x2~', 'turn_in_2x2', 'run_2x5', 'run_2x2~', 'run_2x2~', 'turn_in_2x2', 'run_2x5~', 'run_2x5'],
    );
    const scales = [1.060238, 0.999958, 1.093735, 1.086811, 0.999954, 1.026608, 1.043372, 0.999965, 1.054254, 1.003159, 1.064638, 0.999937, 1.112126, 1.014567];
    placed.forEach((pl, k) => expect(pl.at.scale).toBeCloseTo(scales[k], 5));
    expect(placed[0].P[0]).toBeCloseTo(17.238526, 5);
    expect(placed[0].P[1]).toBeCloseTo(5.889548, 5);
    expect(placed[placed.length - 1].Q[0]).toBeCloseTo(17.30083, 5);
    expect(placed[placed.length - 1].Q[1]).toBeCloseTo(5.560434, 5);
  });

  it('lays the same kit without `exact` on every pinned room as before', () => {
    const plain = seedKit().map((p) => ({ ...p, exact: undefined }));
    const before: Record<string, { keys: string[]; scales: number[]; P: V; Q: V }> = {
      'the 18 by 15 notched room': {
        keys: ['run_2x8~', 'turn_in_2x2', 'run_2x8~', 'run_2x2', 'run_2x2~', 'turn_in_2x2', 'run_2x8~', 'run_2x8~', 'turn_in_2x2', 'run_2x8~', 'run_2x2~', 'run_2x2~', 'turn_in_2x2', 'run_2x2', 'run_2x2'],
        scales: [1, 0.999988, 1, 1, 1, 0.999951, 1, 1, 0.999981, 1, 1, 1, 0.999945, 1.434783, 1.477537],
        P: [15.406532, 5.857944],
        Q: [13.629776, 5.860769],
      },
      'the 16 by 11 notched room': {
        keys: ['run_2x5', 'turn_in_2x2', 'run_2x8~', 'turn_in_2x2', 'run_2x8~', 'run_2x5~', 'run_2x2~', 'turn_in_2x2', 'run_2x8~', 'turn_in_2x2', 'run_2x2', 'run_2x2'],
        scales: [1, 0.999937, 1, 0.999837, 1, 1, 0.999997, 0.999978, 1, 0.999922, 1.434783, 1.434062],
        P: [15.406532, 5.857944],
        Q: [13.629776, 5.860769],
      },
      'a 10.5 by 8 room': {
        keys: ['turn_in_2x2', 'run_2x5', 'run_2x2~', 'run_2x1', 'turn_in_2x2', 'run_2x5~', 'run_2x1', 'turn_in_2x2', 'run_2x8~', 'turn_in_2x2', 'run_2x5', 'run_2x1~'],
        scales: [0.99989, 1, 1, 1, 0.999993, 1, 1, 0.99999, 1, 0.999985, 1, 1],
        P: [2.320029, 3.971533],
        Q: [2.322968, 3.370872],
      },
      'an L-shaped room': {
        keys: ['turn_in_2x2', 'run_2x5', 'run_2x2~', 'run_2x1', 'turn_in_2x2', 'run_2x2~', 'run_2x1', 'turn_in_2x2', 'run_2x2~', 'turn_out_2x2', 'run_2x2', 'turn_in_2x2', 'run_2x2~', 'run_2x1', 'turn_in_2x2', 'run_2x5~', 'run_2x2', 'run_2x1~'],
        scales: [0.999901, 1, 1, 1, 0.999985, 1, 1, 0.999979, 1, 0.999964, 1, 0.999919, 1, 1, 0.999939, 1, 1, 1],
        P: [-0.17997, 1.45769],
        Q: [-0.176941, 0.857694],
      },
      'a 10.5 by 8 room with a door on its top side': {
        keys: ['run_2x2', 'turn_in_2x2', 'turn_in_2x2', 'run_2x5', 'turn_in_2x2', 'run_2x8~', 'turn_in_2x2', 'run_2x5~', 'run_2x1', 'run_2x5'],
        scales: [1, 0.999899, 0.999999, 1, 0.999953, 1, 0.99995, 1, 1.147399, 0.810023],
        P: [8.823251, 2.32],
        Q: [6.725243, 2.32],
      },
    };
    for (const { name, poly, gaps } of pinned) {
      const [ring] = orientRings([poly]);
      const placed = layBandRing(ring, gaps(ring), plain);
      const want = before[name];
      expect(placed.map((pl) => pl.piece.key + (pl.piece.flipY ? '~' : ''))).toEqual(want.keys);
      placed.forEach((pl, k) => expect(pl.at.scale).toBeCloseTo(want.scales[k], 5));
      for (const [got, at] of [[placed[0].P, want.P], [placed[placed.length - 1].Q, want.Q]]) {
        expect(got[0]).toBeCloseTo(at[0], 5);
        expect(got[1]).toBeCloseTo(at[1], 5);
      }
    }
  });
});
