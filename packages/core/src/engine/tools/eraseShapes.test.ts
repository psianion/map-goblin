import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createDungeonLayer } from '../../store/factories';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { carveCommands, carveFloors, floorPieces } from './eraseShapes';
import { computeMergedFloor } from '../mergedFloor';
import { FLATTEN_TOLERANCE, flattenRing } from '../../shared/bezier';
import { resetAssetPackManager, seedPack } from '../../testing/seedCatalog';
import { extractMoveSegments, extractWallSegments } from '../lighting/raycaster';
import { ringOpeningGaps } from '../../shared/caveFloor';
import { patchArea } from '../../shared/materialPatch';
import { commitNewFloor } from './newFloor';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const floor = (id: string, contours: [number, number][][], over: Partial<ShapeChild> = {}): ShapeChild => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  ...over,
});

const area = (r: [number, number][]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};

function seed(children: ShapeChild[]): DungeonLayer {
  const layer = { ...createDungeonLayer('Stone floor', useStore.getState().ui.activeLevelId), id: 'l1', children };
  useStore.setState((s) => {
    s.layers = [layer];
    s.ui.activeLayerId = 'l1';
  });
  return useStore.getState().layers[0] as DungeonLayer;
}

const shapes = () => (useStore.getState().layers[0] as DungeonLayer).children.filter((c): c is ShapeChild => c.childType === 'shape');

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('carve out', () => {
  it('subtracts the shape from every floor it overlaps on the layer, as one undo step', () => {
    const layer = seed([floor('a', [rect(0, 0, 4, 4)]), floor('b', [rect(4, 0, 4, 4)]), floor('c', [rect(20, 0, 2, 2)])]);
    expect(carveFloors(layer, 'l1', [rect(3, 1, 2, 2)])).toBe(true);
    const [a, b, c] = shapes();
    expect(a.contours).toHaveLength(1);
    // The carve bites into both edges, each floor losing a 1 × 2 notch.
    expect(area(a.contours[0])).toBeCloseTo(14);
    expect(area(b.contours[0])).toBeCloseTo(14);
    expect(c.contours).toEqual([rect(20, 0, 2, 2)]);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(shapes().map((s) => s.contours)).toEqual([[rect(0, 0, 4, 4)], [rect(4, 0, 4, 4)], [rect(20, 0, 2, 2)]]);
  });

  it('splits a floor in two, each piece a new floor in its place, the walls and rooms left alone', () => {
    const layer = seed([floor('a', [rect(0, 0, 9, 3)], { textureId: 'p:moss', opacity: 0.5 }), floor('z', [rect(20, 0, 2, 2)])]);
    const walls = structuredClone(layer.standaloneWalls);
    const rooms = structuredClone(layer.rooms);
    carveFloors(layer, 'l1', [rect(4, -1, 1, 5)]);
    const after = shapes();
    expect(after).toHaveLength(3);
    const [left, right, z] = after;
    expect(left.id).not.toBe('a');
    expect(right.id).not.toBe('a');
    expect(left.id).not.toBe(right.id);
    expect(z.id).toBe('z');
    expect([area(left.contours[0]), area(right.contours[0])].sort()).toEqual([12, 12]);
    expect(left).toMatchObject({ textureId: 'p:moss', opacity: 0.5 });
    const l = useStore.getState().layers[0] as DungeonLayer;
    expect(l.standaloneWalls).toEqual(walls);
    expect(l.rooms).toEqual(rooms);
    undoManager.undo();
    expect(shapes().map((s) => s.id)).toEqual(['a', 'z']);
  });

  it('deletes a floor the shape covers entirely', () => {
    const layer = seed([floor('a', [rect(1, 1, 2, 2)]), floor('b', [rect(10, 0, 4, 4)])]);
    carveFloors(layer, 'l1', [rect(0, 0, 5, 5)]);
    expect(shapes().map((s) => s.id)).toEqual(['b']);
    undoManager.undo();
    expect(shapes().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('cuts a hole when it lands inside a floor', () => {
    const layer = seed([floor('a', [rect(0, 0, 10, 10)])]);
    carveFloors(layer, 'l1', [rect(4, 4, 2, 2)]);
    const [a] = shapes();
    expect(a.id).toBe('a');
    expect(a.contours).toHaveLength(2);
  });

  it('flattens curved edges first and says so', () => {
    const curved = floor('a', [rect(0, 0, 4, 4)], { tangents: [[{ tout: [2, -2] }, null, null, null]] });
    const layer = seed([curved]);
    const carve = carveCommands(layer, 'l1', [rect(3, 3, 2, 2)]);
    expect(carve.flattened).toBe(true);
    carveFloors(layer, 'l1', [rect(3, 3, 2, 2)]);
    expect(shapes()[0].tangents).toBeUndefined();
  });

  it('leaves locked floors and floors it misses alone', () => {
    const layer = seed([floor('a', [rect(0, 0, 4, 4)], { locked: true }), floor('b', [rect(10, 0, 4, 4)])]);
    expect(carveFloors(layer, 'l1', [rect(1, 1, 2, 2)])).toBe(false);
    expect(undoManager.size()).toBe(0);
  });
});

describe('one flattening for every consumer', () => {
  it('the floor union and the carve both see the curve as flattenRing lays it', () => {
    const tangents = [[{ tout: [1.5, -2] as [number, number] }, { tin: [2.5, -2] as [number, number] }, null, null]];
    const curved = floor('a', [rect(0, 0, 4, 4)], { tangents });
    const flat = flattenRing(rect(0, 0, 4, 4), tangents[0]);
    expect(flat.length).toBeGreaterThan(4);
    const layer = seed([curved]);
    // The union every renderer, hit test and the band read.
    const union = computeMergedFloor(layer)!;
    expect(area(union[0])).toBeCloseTo(area(flat), 6);
    // The carve: the same flattened ring, less the 1 × 1 bite.
    carveFloors(layer, 'l1', [rect(3, 3, 1, 1)]);
    expect(area(shapes()[0].contours[0])).toBeCloseTo(area(flat) - 1, 2);
    expect(FLATTEN_TOLERANCE).toBe(0.05);
  });
});

describe('an erase across a cave-edged room', () => {
  const BAND = 'Test_Band';
  // One measured straight makes a band set.
  const seedBand = () =>
    seedPack('test-pack', {
      run_2x2_A: { type: 'object', material: 'run', gridSize: '2x2', pieceType: 'object', variant: 'A', set: BAND, tags: [], band: { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0 } },
    });
  const layerNow = () => useStore.getState().layers[0] as DungeonLayer;
  /** The union as the store's subscriber leaves it after a change. */
  const reunion = () => {
    const merged = computeMergedFloor(layerNow());
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).mergedFloor = merged;
    });
    return layerNow();
  };
  const room = (set = BAND) => {
    seed([floor('room', [rect(0, 0, 10, 8)], { styleOverrides: { wallTextureSetId: set } })]);
    return reunion();
  };
  const length = (segs: { x1: number; y1: number; x2: number; y2: number }[]) => segs.reduce((a, s) => a + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
  /** Where the segments along the top edge (y = 0) stop and start again. */
  const topHole = (segs: { x1: number; y1: number; x2: number; y2: number }[]) => {
    const top = segs.filter((s) => Math.abs(s.y1) < 1e-6 && Math.abs(s.y2) < 1e-6).map((s) => [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]);
    const left = Math.max(...top.filter(([, b]) => b < 5).map(([, b]) => b));
    const right = Math.min(...top.filter(([a]) => a > 4).map(([a]) => a));
    return { left, right, top };
  };
  const cut = [rect(4, -0.5, 1, 1)];

  beforeEach(() => seedBand());
  afterEach(() => resetAssetPackManager());

  it('keeps the cut as an opening, and light, sight and tokens pass there and nowhere else', () => {
    expect(carveFloors(room(), 'l1', cut)).toBe(true);
    const l = reunion();
    expect(patchArea(l.caveOpenings ?? [])).toBeCloseTo(1, 3);
    for (const segs of [extractWallSegments([l], 'light'), extractWallSegments([l], 'sight'), extractMoveSegments([l])]) {
      const { left, right, top } = topHole(segs);
      expect(right - left).toBeGreaterThan(0.85);
      expect(right - left).toBeLessThan(1.15);
      // The walls either side of the hole still block.
      expect(top.some(([a, b]) => a < 0.01 && b > 3.9)).toBe(true);
      expect(top.some(([a, b]) => a < 5.1 && b > 9.99)).toBe(true);
      // The room's other three sides, whole: no hole anywhere else.
      expect(length(segs)).toBeCloseTo(36 - (right - left), 3);
    }
    // The band's rock stops along the same stretch.
    const gaps = ringOpeningGaps(l.mergedFloor![0], 0, l.caveOpenings).filter((g) => Math.abs(g.position[1]) < 1e-6);
    expect(Math.min(...gaps.map((g) => g.position[0] - g.width / 2))).toBeCloseTo(topHole(extractWallSegments([l])).left, 6);
    expect(Math.max(...gaps.map((g) => g.position[0] + g.width / 2))).toBeCloseTo(topHole(extractWallSegments([l])).right, 6);
    expect(Math.max(...gaps.map((g) => g.width))).toBeLessThanOrEqual(0.5);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(layerNow().caveOpenings).toBeUndefined();
  });

  it('keeps no opening with Rock on cut edge on, and the ring blocks all round', () => {
    useStore.setState((s) => {
      s.tools.settings.material.rockOnCut = true;
    });
    carveFloors(room(), 'l1', cut);
    const l = reunion();
    expect(l.caveOpenings).toBeUndefined();
    // The ring round the notch: 36, less the cell of edge cut, plus the notch's three sides.
    expect(length(extractWallSegments([l]))).toBeCloseTo(37, 3);
    expect(length(extractMoveSegments([l]))).toBeCloseTo(37, 3);
  });

  it('opens nothing for an erase wholly inside the room or wholly outside it', () => {
    carveFloors(room(), 'l1', [rect(4, 3, 1, 1)]);
    expect(layerNow().caveOpenings).toBeUndefined();
    expect(carveFloors(reunion(), 'l1', [rect(4, -3, 1, 1)])).toBe(false);
    expect(layerNow().caveOpenings).toBeUndefined();
  });

  it('opens nothing on a room walled with a stone set, and cuts its floor as before', () => {
    carveFloors(room('Stone_Set'), 'l1', cut);
    expect(layerNow().caveOpenings).toBeUndefined();
    expect(area(shapes()[0].contours[0])).toBeCloseTo(79.5);
  });

  it('closes the opening when a floor is drawn back over it', () => {
    carveFloors(room(), 'l1', cut);
    useStore.setState((s) => {
      s.tools.settings.floorWalls = BAND;
    });
    commitNewFloor('Draw rectangle', 'l1', floor('patch', [rect(3, -1, 3, 2)]));
    expect(layerNow().caveOpenings).toBeUndefined();
    undoManager.undo();
    expect(layerNow().caveOpenings).toBeDefined();
  });

  it('drops the opening once the room is erased away', () => {
    carveFloors(room(), 'l1', cut);
    carveFloors(reunion(), 'l1', [rect(-1, -1, 12, 10)]);
    expect(shapes()).toHaveLength(0);
    expect(layerNow().caveOpenings).toBeUndefined();
  });
});

describe('floorPieces', () => {
  it('gives each outer ring the holes inside it', () => {
    const outerA = rect(0, 0, 10, 10);
    const hole = [...rect(2, 2, 2, 2)].reverse() as [number, number][];
    const outerB = rect(20, 0, 4, 4);
    expect(floorPieces([outerB, hole, outerA])).toEqual([[outerA, hole], [outerB]]);
  });
});
