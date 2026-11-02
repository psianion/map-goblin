// Rooms that sit inside another face: a tower walled off in a field, and a raised room on the
// ground. Each anchor takes the face it is actually in, not the field around it.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { syncRooms } from './roomSync';
import type { DungeonLayer, ShapeChild } from './types';
import type { WallSegment } from '../shared/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeChild> = {}): ShapeChild => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  ...extra,
});

const layerOf = (children: ShapeChild[], walls: WallSegment[] = []) =>
  ({
    id: 'l1',
    type: 'dungeon',
    children,
    standaloneWalls: walls,
    mergedFloor: null,
    style: { wallWidth: 0.5 },
    rooms: [
      { id: 'field', name: 'Field', anchor: [1, 1] },
      { id: 'inner', name: 'Inner', anchor: [10, 10] },
    ],
  }) as unknown as DungeonLayer;

const area = (layer: DungeonLayer, id: string) => syncRooms(layer).rooms.find((r) => r.id === id)!.area!;

describe('rooms inside another face', () => {
  it('gives a tower walled off in a field its own face', () => {
    const tower: WallSegment = {
      id: 'tower',
      points: [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]],
      wallType: 'normal',
      direction: 'both',
      color: '#000',
      width: 0.5,
      roughness: 0,
    };
    const layer = layerOf([rect('ground', 0, 0, 20, 20)], [tower]);
    expect(area(layer, 'inner')).toBeLessThan(16);
    expect(area(layer, 'field')).toBeGreaterThan(300);
  });

  it('gives a raised room on the ground its own face', () => {
    const layer = layerOf([rect('ground', 0, 0, 20, 20), rect('tower', 8, 8, 12, 12, { height: 2 })]);
    expect(area(layer, 'inner')).toBeLessThan(16);
  });
});
