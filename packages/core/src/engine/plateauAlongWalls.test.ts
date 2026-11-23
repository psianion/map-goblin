// A raised room along a measured kit's rock line (`DungeonLayer.rockLines`): its cliff is laid
// on the rock, its top tint is fitted to the rock as the floor is, only along the shared edge,
// and a walled floor's painted border keeps inside the fitted outline.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./caveBandRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./caveBandRenderer')>()),
  layBandRing: vi.fn(() => []),
  layBandChain: vi.fn(() => []),
}));
// A kit to walk with, so the cliff's walk is asked for; the stub lays nothing.
vi.mock('./plateauKit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plateauKit')>()),
  cliffPieces: () => [{ key: 'stub', turnDeg: 0 }],
}));

import { Container, Graphics } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { fittedFloor, layBandRing, type FloorFit } from './caveBandRenderer';
import { fittedAlongWalls, laidRuns, plateauAlongWalls, renderPlateaus } from './plateauRenderer';
import { pieceBorderRamp } from './pieceRenderer';
import { layerPlateaus } from '../shared/plateaus';
import type { DungeonLayer, PlateauChild, RockLine, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

beforeEach(() => vi.mocked(layBandRing).mockClear());

type Pt = [number, number];

const room: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];

/** The 10 by 8 room's rock, wandering 0.3 either side of the top edge. */
const rock: RockLine = {
  edge: room,
  closed: true,
  runs: [[[0, 0], [2, 0.3], [4, -0.3], [6, 0.3], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0]]],
};
const loop = rock.runs[0].slice(0, -1);

/** The fit the room's floor gets under that rock: floor past it off, ground up to it on. */
function fitOf(): FloorFit {
  const seat = clipper2Engine.union([loop], []);
  return { tips: clipper2Engine.difference([room], seat), gaps: clipper2Engine.difference(seat, [room]) };
}

function plat(id: string, ring: Pt[], extra: Partial<PlateauChild> = {}): PlateauChild {
  return { id, name: id, childType: 'plateau', visible: true, contours: [ring], height: 2, edge: 'cliff', ...extra };
}

let seq = 0;
const layerOf = (children: DungeonLayer['children'], extra: Partial<DungeonLayer> = {}) =>
  ({ id: `along-${seq++}`, type: 'dungeon', children, standaloneWalls: [], mergedFloor: [room], style: {}, ...extra }) as unknown as DungeonLayer;

const area = (rings: Polygon[]) =>
  rings.reduce((sum, r) => sum + r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2, 0);
/** How much of either region lies outside the other. */
const apart = (a: Polygon[], b: Polygon[]) => area(clipper2Engine.difference(a, b)) + area(clipper2Engine.difference(b, a));

/** `b` as the loop `a`, from wherever it starts. */
function asLoop(a: readonly Pt[], b: readonly Pt[]): Pt[] {
  const i = b.findIndex((p) => p[0] === a[0][0] && p[1] === a[0][1]);
  return i < 0 ? [...b] : [...b.slice(i), ...b.slice(0, i)];
}

describe('a raised room along its rock line', () => {
  it('walks no cliff on the rock, the wall standing for it, and lays its run on the rock with one drop per segment', () => {
    const layer = layerOf([plat('raised', room)], { rockLines: [rock] });
    renderPlateaus(layer, new Container(), new Container());
    expect(vi.mocked(layBandRing).mock.calls).toHaveLength(0);
    const [band] = layerPlateaus(layer).bands;
    const [{ laid, walk, cliffs }] = laidRuns(layer, band);
    expect(walk.points).toEqual(asLoop(walk.points, loop));
    expect(cliffs).toEqual([]);
    expect(laid.drops).toHaveLength(laid.points.length);
    expect(laid.drops.every((d) => d === 2)).toBe(true);
  });

  it('walks its cliff on the drawn outline with no rock line and no wall', () => {
    const layer = layerOf([plat('raised', room)], { mergedFloor: [] });
    renderPlateaus(layer, new Container(), new Container());
    const walked = vi.mocked(layBandRing).mock.calls.map((c) => c[0] as Pt[]);
    expect(walked).toEqual([layerPlateaus(layer).bands[0].rings[0]]);
  });

  it('fits its top tint as the floor is fitted along the shared edge', () => {
    const layer = layerOf([plat('raised', room)], { rockLines: [rock] });
    const [band] = layerPlateaus(layer).bands;
    const fit = fitOf();
    const top = fittedAlongWalls(band.surface, laidRuns(layer, band), fit);
    expect(apart(top, fittedFloor(band.surface, fit))).toBeCloseTo(0, 3);
    expect(apart(top, band.surface)).toBeGreaterThan(1);
    expect(apart(plateauAlongWalls(layer, layer.children[0] as PlateauChild, band.surface, fit, false), top)).toBeCloseTo(0, 3);
    // Drawn so: the tint reaches out to the rock where it bows past the drawn top.
    const tops = new Container();
    renderPlateaus(layer, tops, new Container(), { fit });
    const tint = tops.children.find((c) => c.label === 'plateau-top-2') as Graphics;
    expect(tint.getLocalBounds().minY).toBeCloseTo(-0.3, 2);
  });

  it('leaves a plateau 0.5 cell inside the room as it is', () => {
    const inner: Pt[] = [[0.5, 0.5], [9.5, 0.5], [9.5, 7.5], [0.5, 7.5]];
    const layer = layerOf([plat('inner', inner)], { rockLines: [rock] });
    const [band] = layerPlateaus(layer).bands;
    const runs = laidRuns(layer, band);
    expect(runs.every((r) => r.laid === r.run && r.zone.length === 0)).toBe(true);
    expect(fittedAlongWalls(band.surface, runs, fitOf())).toBe(band.surface);
  });
});

describe('a walled floor’s painted border', () => {
  const floor: ShapeChild = {
    id: 'floor',
    name: 'floor',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [room],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    edgePaint: 'border',
  };
  const reach = (ramp: { clip: Polygon[] | null } | null) => Math.min(...(ramp?.clip ?? []).flat().map((p) => p[1]));

  it('keeps inside the fitted outline under a fit, and inside the drawn one without', () => {
    expect(reach(pieceBorderRamp(floor, fitOf()))).toBeCloseTo(-0.3, 2);
    expect(reach(pieceBorderRamp(floor))).toBeCloseTo(0, 6);
  });
});
