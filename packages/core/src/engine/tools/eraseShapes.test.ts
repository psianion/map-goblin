import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createDungeonLayer } from '../../store/factories';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { carveCommands, carveFloors, floorPieces } from './eraseShapes';
import { computeMergedFloor } from '../mergedFloor';
import { FLATTEN_TOLERANCE, flattenRing } from '../../shared/bezier';

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

describe('floorPieces', () => {
  it('gives each outer ring the holes inside it', () => {
    const outerA = rect(0, 0, 10, 10);
    const hole = [...rect(2, 2, 2, 2)].reverse() as [number, number][];
    const outerB = rect(20, 0, 4, 4);
    expect(floorPieces([outerB, hole, outerA])).toEqual([[outerA, hole], [outerB]]);
  });
});
