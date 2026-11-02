// Rooms that sit inside another face: a tower walled off in a field, and a raised room on the
// ground. Each anchor takes the face it is actually in, not the field around it.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { layerFaces, syncRooms } from './roomSync';
import { computeMergedFloor } from '../engine/mergedFloor';
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

describe('a lone floor at height keeps its rooms', () => {
  const cave = (height: number, edge: 'cliff' | 'slope' | 'none') =>
    ({
      id: 'l1',
      type: 'dungeon',
      children: [rect('cave', 0, 0, 8, 7, { height, edge })],
      standaloneWalls: [
        {
          id: 'split',
          points: [[4, 0], [4, 7]],
          wallType: 'normal',
          direction: 'both',
          color: '#000',
          width: 0.5,
          roughness: 0,
        },
      ],
      mergedFloor: null,
      style: { wallWidth: 0.5 },
      rooms: [
        { id: 'west', name: 'West', anchor: [2, 3] },
        { id: 'east', name: 'East', anchor: [6, 3] },
      ],
    }) as unknown as DungeonLayer;

  for (const height of [1, -1]) {
    for (const edge of ['cliff', 'slope', 'none'] as const) {
      it(`places every room on a lone floor at ${height} with a ${edge} edge`, () => {
        const layer = cave(height, edge);
        expect(layerFaces(layer)).toHaveLength(2);
        const { rooms } = syncRooms(layer);
        expect(rooms.filter((r) => r.orphaned)).toHaveLength(0);
        expect(new Set(rooms.map((r) => r.area!.toFixed(2))).size).toBe(1);
      });
    }
  }
});

async function fixtureLayer(name: string): Promise<DungeonLayer> {
  const { readFileSync } = await import('node:fs' as string);
  const { resolve } = await import('node:path' as string);
  const { migrateToLatest } = await import('./migration');
  const { migrateRooms } = await import('./roomMigration');
  const path = resolve(process.cwd(), '../..', `session/testdata/${name}.mapbuilder`);
  const data = migrateRooms(migrateToLatest(JSON.parse(readFileSync(path, 'utf8'))));
  return data.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

describe('the warren cave raised or sunk', () => {
  for (const height of [1, -1]) {
    for (const edge of ['wall', 'cliff', 'slope', 'none'] as const) {
      it(`keeps 7 faces and no orphan at ${height} with a ${edge} edge`, async () => {
        const base = await fixtureLayer('goblin-warren');
        const layer = {
          ...base,
          mergedFloor: null,
          children: base.children.map((c) => (c.id === 'floor-cave-0' ? { ...c, height, edge } : c)),
        } as DungeonLayer;
        expect(computeMergedFloor(layer)).toHaveLength(1);
        expect(layerFaces(layer)).toHaveLength(7);
        const { rooms } = syncRooms(layer);
        expect(rooms).toHaveLength(7);
        expect(rooms.filter((r) => r.orphaned)).toHaveLength(0);
      });
    }
  }
});

describe('rooms inside rooms on a flat map (ad0e1e9 kept)', () => {
  const inside = (p: [number, number], ring: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  it('gives a walled chamber inside a hall its own face and label, and the hall its own', () => {
    const chamber: WallSegment = {
      id: 'chamber',
      points: [[2, 2], [7, 2], [7, 6], [2, 6], [2, 2]],
      wallType: 'normal',
      direction: 'both',
      color: '#000',
      width: 0.5,
      roughness: 0,
    };
    const layer = {
      ...layerOf([rect('hall', 0, 0, 24, 16)], [chamber]),
      rooms: [
        { id: 'hall', name: 'Hall', anchor: [18, 10] },
        { id: 'chamber', name: 'Chamber', anchor: [4.5, 4] },
      ],
    } as unknown as DungeonLayer;
    const { rooms } = syncRooms(layer);
    const hall = rooms.find((r) => r.id === 'hall')!;
    const room = rooms.find((r) => r.id === 'chamber')!;
    expect(rooms.filter((r) => r.orphaned)).toHaveLength(0);
    expect(room.area!).toBeLessThan(20);
    expect(hall.area!).toBeGreaterThan(300);
    // Each label sits in its own room: the chamber's inside the walls, the hall's outside them.
    const walls = chamber.points as [number, number][];
    expect(inside(room.centroid as [number, number], walls)).toBe(true);
    expect(inside(hall.centroid as [number, number], walls)).toBe(false);
    expect(inside(hall.centroid as [number, number], hall.face as [number, number][])).toBe(true);
  });

  for (const [name, count] of [
    ['fieldstone-keep', 12],
    ['emberhold-crypt', 13],
  ] as const) {
    it(`keeps all ${count} rooms of ${name}, each placed`, async () => {
      const layer = await fixtureLayer(name);
      const { rooms } = syncRooms({ ...layer, mergedFloor: null });
      expect(rooms).toHaveLength(count);
      expect(rooms.filter((r) => r.orphaned).map((r) => r.id)).toEqual([]);
      expect(new Set(rooms.map((r) => JSON.stringify(r.face))).size).toBe(count);
    });
  }
});
