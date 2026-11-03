// Rooms that sit inside another face: a tower walled off in a field. Each anchor takes the face
// it is actually in, not the field around it. And plateaus, which are relief, never touch a room.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { layerFaces, syncRooms } from './roomSync';
import { computeMergedFloor } from '../engine/mergedFloor';
import type { DungeonLayer, PlateauChild, ShapeChild } from './types';
import type { WallSegment } from '../shared/types';
import { layBandRing, orientRings } from '../engine/caveBandRenderer';

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

const plat = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height: 1,
  edge: 'cliff',
  ...extra,
});

const layerOf = (children: (ShapeChild | PlateauChild)[], walls: WallSegment[] = []) =>
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

  it('gives a plateau on the ground no face of its own', () => {
    const layer = layerOf([rect('ground', 0, 0, 20, 20), plat('mesa', 8, 8, 12, 12, { height: 2 })]);
    expect(layerFaces(layer)).toHaveLength(1);
    expect(area(layer, 'inner')).toBeCloseTo(area(layer, 'field'));
  });
});

describe('a plateau partly over a room', () => {
  const tower: WallSegment = {
    id: 'tower',
    points: [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]],
    wallType: 'normal',
    direction: 'both',
    color: '#000',
    width: 0.5,
    roughness: 0,
  };

  for (const edge of ['cliff', 'slope', 'none'] as const) {
    for (const height of [2, -1]) {
      it(`leaves every face as it was under a ${edge} at ${height}`, () => {
        const flat = layerOf([rect('ground', 0, 0, 20, 20)], [tower]);
        // Straddling the tower's east wall and running off the floor's edge.
        const layer = layerOf([rect('ground', 0, 0, 20, 20), plat('ridge', 10, 6, 24, 14, { height, edge })], [tower]);
        expect(computeMergedFloor(layer)).toEqual(computeMergedFloor(flat));
        expect(JSON.stringify(layerFaces(layer))).toBe(JSON.stringify(layerFaces(flat)));
        expect(JSON.stringify(syncRooms(layer).rooms)).toBe(JSON.stringify(syncRooms(flat).rooms));
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

describe('a plateau on the warren floor (W-12)', () => {
  // The cave band the walls lay along each ring of the merged floor, as the renderer lays it.
  const band = (floor: ReturnType<typeof computeMergedFloor>) =>
    JSON.stringify(orientRings(floor ?? []).map((ring) => layBandRing(ring)));

  for (const height of [1, -1, 3]) {
    for (const edge of ['cliff', 'slope', 'none'] as const) {
      it(`keeps the floor, the cave band and the 7 faces at ${height} with a ${edge} edge`, async () => {
        const base = await fixtureLayer('goblin-warren');
        const flat = { ...base, mergedFloor: null } as DungeonLayer;
        const floor = base.children.find((c): c is ShapeChild => c.id === 'floor-cave-0')!;
        const plateau: PlateauChild = {
          id: 'cave-plateau',
          name: 'Cave plateau',
          childType: 'plateau',
          visible: true,
          contours: floor.contours,
          tangents: floor.tangents,
          transform: floor.transform,
          height,
          edge,
        };
        const layer = { ...flat, children: [...flat.children, plateau] } as DungeonLayer;
        const before = computeMergedFloor(flat);
        const after = computeMergedFloor(layer);
        expect(after).toEqual(before);
        expect(after).toHaveLength(1);
        expect(band(after)).toBe(band(before));
        expect(layerFaces(layer)).toHaveLength(7);
        expect(JSON.stringify(layerFaces(layer))).toBe(JSON.stringify(layerFaces(flat)));
        const { rooms } = syncRooms(layer);
        expect(rooms).toHaveLength(7);
        expect(rooms.filter((r) => r.orphaned)).toHaveLength(0);
        expect(JSON.stringify(rooms)).toBe(JSON.stringify(syncRooms(flat).rooms));
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
