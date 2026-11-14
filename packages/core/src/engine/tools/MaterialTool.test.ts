// The brush paints floor pieces in the layer's one stack: a stroke merges into the piece of
// the same look it touches only when nothing lies over it there, keeps to its side of the
// walls unless Paint over rooms is on, and Erase cuts the top piece alone (eraseShapes.ts).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer, MaterialToolSettings, ShapeChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { patchArea } from '../../shared/materialPatch';
import { pieceCovers } from '../../shared/pieces';
import { computeMergedFloor } from '../mergedFloor';
import { hasPieceLook, keepToRooms, mergeTarget, paintGroundPiece, pieceLook, type PieceLook } from './MaterialTool';
import { carveFloors, eraseTargets, pieceRegion, planErase } from './eraseShapes';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const GRASS = 'pack:wild_grass_8x8_floor_A';
const DIRT = 'pack:wild_dirt_8x8_floor_A';

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piece(id: string, ring: Polygon, extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ...extra,
  };
}

const ground = (id: string, ring: Polygon, textureId: string, extra: Partial<ShapeChild> = {}) => piece(id, ring, { ground: true, textureId, ...extra });

let layerId = '';
beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
});

function setPieces(...children: ShapeChild[]): DungeonLayer {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === layerId) as DungeonLayer;
    l.children = children;
    l.mergedFloor = computeMergedFloor({ ...l, children } as DungeonLayer);
  });
  return layer();
}

const layer = () => useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
const shapes = () => layer().children.filter((c): c is ShapeChild => c.childType === 'shape');
const area = (id: string) => patchArea(pieceRegion(shapes().find((c) => c.id === id)!));
const settings = (extra: Partial<MaterialToolSettings> = {}): MaterialToolSettings => ({ material: GRASS, radius: 2, smooth: false, border: false, floor: false, ...extra });
const look = (textureId: string): PieceLook => ({ textureId });

describe('what a stroke paints with', () => {
  it('takes the texture, Strength as opacity and the height, and nothing it was not given', () => {
    expect(pieceLook(GRASS, settings())).toEqual({ textureId: GRASS, soft: 1 });
    expect(pieceLook(GRASS, settings({ strength: 0.5, height: 1 }))).toEqual({ textureId: GRASS, soft: 1, opacity: 0.5, height: 1 });
    expect(pieceLook(GRASS, settings({ strength: 1, feather: 0 }))).toEqual({ textureId: GRASS });
  });

  it('merges only with ground of the very same look', () => {
    expect(hasPieceLook(ground('a', rect(0, 0, 2, 2), GRASS), look(GRASS))).toBe(true);
    expect(hasPieceLook(ground('a', rect(0, 0, 2, 2), GRASS, { opacity: 0.5 }), look(GRASS))).toBe(false);
    expect(hasPieceLook(ground('a', rect(0, 0, 2, 2), DIRT), look(GRASS))).toBe(false);
    // A walled floor is never painted into, whatever its texture.
    expect(hasPieceLook(piece('a', rect(0, 0, 2, 2), { textureId: GRASS }), look(GRASS))).toBe(false);
  });
});

describe('where a stroke lands in the stack', () => {
  it('is a new ground piece on top of an empty layer', () => {
    setPieces();
    paintGroundPiece(layer(), layerId, [rect(0, 0, 4, 4)], GRASS, look(GRASS), false);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ ground: true, textureId: GRASS, contours: [rect(0, 0, 4, 4)] });
    expect(shapes()[0].name).toMatch(/ 1$/);
    expect(layer().mergedFloor ?? null).toBeNull();
  });

  it('merges into the piece of the same look it touches, which keeps its id and place', () => {
    setPieces(ground('grass', rect(0, 0, 4, 4), GRASS), ground('dirt', rect(20, 0, 24, 4), DIRT));
    paintGroundPiece(layer(), layerId, [rect(3, 0, 8, 4)], GRASS, look(GRASS), false);
    expect(shapes().map((c) => c.id)).toEqual(['grass', 'dirt']);
    expect(area('grass')).toBeCloseTo(32, 6);
    undoManager.undo();
    expect(area('grass')).toBeCloseTo(16, 6);
  });

  it('lands on top as a new piece when another piece lies over the stroke: paint never goes under what covers it', () => {
    const below = setPieces(ground('grass', rect(0, 0, 10, 10), GRASS), ground('path', rect(4, 0, 6, 10), DIRT));
    // The stroke crosses the path: the grass under it is buried there.
    expect(mergeTarget(below, [rect(2, 4, 8, 6)], look(GRASS))).toBeNull();
    paintGroundPiece(below, layerId, [rect(2, 4, 8, 6)], GRASS, look(GRASS), false);
    expect(shapes().map((c) => c.id).slice(0, 2)).toEqual(['grass', 'path']);
    expect(shapes()).toHaveLength(3);
    expect(shapes()[2]).toMatchObject({ ground: true, textureId: GRASS });
    expect(area('grass')).toBeCloseTo(100, 6);
  });

  it('merges into the buried piece where the stroke stays clear of what covers it', () => {
    const l = setPieces(ground('grass', rect(0, 0, 10, 10), GRASS), ground('path', rect(4, 0, 6, 10), DIRT));
    expect(mergeTarget(l, [rect(-2, 4, 2, 6)], look(GRASS))?.id).toBe('grass');
  });

  it('merges into the top one of two pieces of the same look', () => {
    const l = setPieces(ground('low', rect(0, 0, 10, 10), GRASS), ground('high', rect(4, 4, 14, 14), GRASS));
    expect(mergeTarget(l, [rect(5, 5, 7, 7)], look(GRASS))?.id).toBe('high');
  });

  it('does not merge into a locked piece or one of another look', () => {
    expect(mergeTarget(setPieces(ground('grass', rect(0, 0, 4, 4), GRASS, { locked: true })), [rect(1, 1, 3, 3)], look(GRASS))).toBeNull();
    expect(mergeTarget(setPieces(ground('dirt', rect(0, 0, 4, 4), DIRT)), [rect(1, 1, 3, 3)], look(GRASS))).toBeNull();
  });
});

describe('Paint over rooms', () => {
  const room = () => setPieces(piece('room', rect(0, 0, 6, 6)));

  it('off, a stroke begun outside the walls stops at them', () => {
    const kept = keepToRooms(room(), [rect(-4, 2, 4, 4)], [-3, 3], false);
    expect(patchArea(kept)).toBeCloseTo(8, 6);
  });

  it('off, a stroke begun inside stays inside', () => {
    const kept = keepToRooms(room(), [rect(-4, 2, 4, 4)], [3, 3], false);
    expect(patchArea(kept)).toBeCloseTo(8, 6);
    expect(kept.flat().every(([x]) => x >= -1e-6)).toBe(true);
  });

  it('on, the stroke covers whatever is under it; and a layer with no walled floor has nothing to keep to', () => {
    const swept = [rect(-4, 2, 4, 4)];
    expect(keepToRooms(room(), swept, [-3, 3], true)).toBe(swept);
    expect(keepToRooms(setPieces(ground('grass', rect(0, 0, 6, 6), GRASS)), swept, [3, 3], false)).toBe(swept);
  });
});

describe('the eraser', () => {
  const stack = () => setPieces(ground('grass', rect(0, 0, 10, 10), GRASS), ground('path', rect(4, 0, 6, 10), DIRT));

  it('cuts only the top piece at every point: erasing a path shows the grass under it, untouched', () => {
    stack();
    // Across the path and out over the grass either side.
    expect(carveFloors(layer(), layerId, [rect(2, 4, 8, 6)], [], 'Erase')).toBe(true);
    // The path is cut in two: each half is a new piece, in the path's place over the grass.
    const halves = shapes().filter((c) => c.textureId === DIRT);
    expect(halves).toHaveLength(2);
    expect(halves.reduce((n, c) => n + patchArea(pieceRegion(c)), 0)).toBeCloseTo(20 - 4, 6);
    expect(shapes()[0].id).toBe('grass');
    // The grass lost only where it was itself on top.
    expect(area('grass')).toBeCloseTo(100 - 8, 6);
    const grass = shapes().find((c) => c.id === 'grass')!;
    expect(pieceCovers(grass, 5, 5)).toBe(true);
    expect(pieceCovers(grass, 3, 5)).toBe(false);
    undoManager.undo();
    expect(area('grass')).toBeCloseTo(100, 6);
    expect(area('path')).toBeCloseTo(20, 6);
  });

  it('walks the pieces top down, each losing what is left of the area', () => {
    const { cuts } = planErase(stack(), [rect(2, 4, 8, 6)]);
    expect(cuts.map((c) => c.shape.id)).toEqual(['path', 'grass']);
    expect(patchArea(cuts[0].cut)).toBeCloseTo(4, 6);
    expect(patchArea(cuts[1].cut)).toBeCloseTo(8, 6);
  });

  it('with a piece selected cuts only that piece, by the whole area', () => {
    stack();
    useStore.getState().setSelectedIds(['grass']);
    carveFloors(layer(), layerId, [rect(2, 4, 8, 6)], [], 'Erase');
    expect(area('grass')).toBeCloseTo(100 - 12, 6);
    expect(area('path')).toBeCloseTo(20, 6);
  });

  it('passes over a locked piece to the one under it, and cuts nothing over bare ground', () => {
    const l = setPieces(ground('grass', rect(0, 0, 10, 10), GRASS), ground('path', rect(4, 0, 6, 10), DIRT, { locked: true }));
    expect(planErase(l, [rect(4.5, 4, 5.5, 6)]).cuts.map((c) => c.shape.id)).toEqual(['grass']);
    expect(planErase(l, [rect(20, 20, 22, 22)]).cuts).toEqual([]);
    expect(carveFloors(l, layerId, [rect(20, 20, 22, 22)])).toBe(false);
  });

  it('cuts a walled floor like any piece, and the union follows', () => {
    const l = setPieces(piece('room', rect(0, 0, 6, 6)), ground('rug', rect(2, 2, 4, 4), DIRT));
    const { cuts } = planErase(l, [rect(1, 1, 5, 5)]);
    expect(cuts.map((c) => c.shape.id)).toEqual(['rug', 'room']);
    expect(patchArea(cuts[1].cut)).toBeCloseTo(16 - 4, 6);
  });

  it('washes the piece under the pointer, or the selection, and nothing over bare ground', () => {
    const l = stack();
    expect(eraseTargets(l, 5, 5, []).map((c) => c.id)).toEqual(['path']);
    expect(eraseTargets(l, 1, 5, []).map((c) => c.id)).toEqual(['grass']);
    expect(eraseTargets(l, 50, 50, [])).toEqual([]);
    expect(eraseTargets(l, 5, 5, ['grass']).map((c) => c.id)).toEqual(['grass']);
  });
});
