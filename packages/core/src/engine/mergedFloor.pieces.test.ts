// Floor pieces and the union: only walled floors join it, each as its own region (its
// outer ring less its own holes), and a ground piece makes no wall and no room.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { createDungeonLayer } from '../store/factories';
import { computeMergedFloor } from './mergedFloor';
import { roomFaces } from './roomDetection';
import { resolveWalls } from '../shared/wallResolve';
import { caveCutters, caveEdges } from '../shared/caveFloor';
import { patchArea } from '../shared/materialPatch';

beforeAll(async () => {
  const fs = (await import('node:fs' as string)) as { readFileSync(p: string): Uint8Array };
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = fs.readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piece(id: string, contours: Polygon[], extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  };
}

function layerOf(...children: ShapeChild[]): DungeonLayer {
  const layer = { ...createDungeonLayer('L'), children };
  return { ...layer, mergedFloor: computeMergedFloor(layer) };
}

describe('the floor union', () => {
  it('leaves ground pieces out', () => {
    const walled = piece('room', [rect(0, 0, 4, 4)]);
    const layer = layerOf(walled, piece('grass', [rect(2, 2, 12, 12)], { ground: true }));
    expect(layer.mergedFloor).toEqual([walled.contours[0]]);
  });

  it('is null on a layer of ground alone', () => {
    expect(layerOf(piece('grass', [rect(0, 0, 8, 8)], { ground: true })).mergedFloor).toBeNull();
  });

  it('hands a lone floor back untouched, and a floor with no flag is walled', () => {
    const ring = rect(0, 0, 5, 3);
    expect(computeMergedFloor(layerOf(piece('a', [ring])))![0]).toBe(ring);
  });

  it('cuts a floor by its own holes only: a floor under the hole still stands', () => {
    const holed = piece('upper', [rect(0, 0, 10, 10), rect(4, 4, 6, 6)]);
    const under = piece('lower', [rect(3, 3, 7, 7)]);
    const floor = layerOf(under, holed).mergedFloor!;
    expect(patchArea(floor)).toBeCloseTo(100, 6);
    expect(floor).toHaveLength(1);
  });

  it('keeps a hole that nothing lies under', () => {
    const floor = layerOf(piece('a', [rect(0, 0, 10, 10), rect(4, 4, 6, 6)]), piece('b', [rect(20, 0, 24, 4)])).mergedFloor!;
    expect(patchArea(floor)).toBeCloseTo(100 - 4 + 16, 6);
  });

  it('unions floors drawn in opposite directions when one is holed', () => {
    const forward = piece('a', [rect(0, 0, 6, 6), rect(1, 1, 2, 2)]);
    const backward = piece('b', [[...rect(4, 0, 10, 6)].reverse()]);
    expect(patchArea(layerOf(forward, backward).mergedFloor!)).toBeCloseTo(60 - 1, 6);
  });
});

describe('a ground piece', () => {
  it('makes no wall', () => {
    const layer = layerOf(piece('grass', [rect(0, 0, 8, 8)], { ground: true }));
    expect(resolveWalls(layer)).toEqual([]);
  });

  it('adds no wall to the floor it lies across', () => {
    const room = piece('room', [rect(0, 0, 4, 4)]);
    const alone = resolveWalls(layerOf(room));
    const withGround = resolveWalls(layerOf(room, piece('path', [rect(2, 1, 9, 2)], { ground: true })));
    expect(withGround.map((w) => w.points)).toEqual(alone.map((w) => w.points));
  });

  it('with a rock rim is no cave: no cave wall, no cut in the room faces', () => {
    const layer = layerOf(piece('rim', [rect(0, 0, 6, 6)], { ground: true, edgeMaterial: 'GG_Cave_Ink' }));
    expect(caveEdges(layer)).toEqual([]);
    expect(caveCutters(layer)).toEqual([]);
    expect(resolveWalls(layer)).toEqual([]);
  });

  it('makes no room', () => {
    const ground = layerOf(piece('grass', [rect(0, 0, 8, 8)], { ground: true }));
    expect(roomFaces(ground.mergedFloor ?? [], [], 1)).toEqual([]);
    const room = layerOf(piece('room', [rect(0, 0, 4, 4)]), piece('grass', [rect(-5, -5, 12, 12)], { ground: true }));
    expect(roomFaces(room.mergedFloor ?? [], [], 1)).toHaveLength(1);
  });
});
