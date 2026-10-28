import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { migrateRooms, needsRoomMigration } from './roomMigration';
import { migrateToLatest } from './migration';
import { syncRooms } from './roomSync';
import { useStore } from './store';
import { computeMergedFloor } from '../engine/mergedFloor';
import type { DungeonLayer, SerializedMapData } from './types';

/** Same wasm hand-off as roomDetection.test.ts — jsdom can't fetch the .wasm. */
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

async function fixture(name: string): Promise<SerializedMapData> {
  const { readFileSync } = await import('node:fs' as string);
  const { resolve } = await import('node:path' as string);
  // Tests run from packages/core, like the cave-band tests that read the same fixture.
  const path = resolve(process.cwd(), '../..', `session/testdata/${name}.mapbuilder`);
  return migrateToLatest(JSON.parse(readFileSync(path, 'utf8')));
}

const dungeons = (data: SerializedMapData): DungeonLayer[] =>
  data.layers.filter((l): l is DungeonLayer => l.type === 'dungeon');

/** Each fixture, the rooms it carries before migration, and how many detected ids it has. */
const FIXTURES: [name: string, rooms: number][] = [
  ['goblin-warren', 7],
  ['fieldstone-keep', 12],
  ['emberhold-crypt', 13],
  ['vision-two-rooms', 2],
  ['demo-dungeon', 0],
];

describe('migrateRooms — the fixture maps', () => {
  for (const [name, count] of FIXTURES) {
    describe(name, () => {
      let before: SerializedMapData;
      let after: SerializedMapData;
      beforeAll(async () => {
        before = await fixture(name);
        after = migrateRooms(structuredClone(before));
      });

      it(`keeps all ${count} room ids as permanent ids, names folded in`, () => {
        const oldRooms = dungeons(before).flatMap((l) => l.rooms ?? []);
        const newRooms = dungeons(after).flatMap((l) => l.rooms ?? []);
        expect(newRooms).toHaveLength(count);
        expect(newRooms.map((r) => r.id)).toEqual(oldRooms.map((r) => r.id));
        const overrides = (l: DungeonLayer) =>
          (l as unknown as { roomNameOverrides?: Record<string, string> }).roomNameOverrides ?? {};
        for (const [i, room] of newRooms.entries()) {
          const old = oldRooms[i];
          const layer = dungeons(before).find((l) => l.rooms?.includes(old))!;
          expect(room.name).toBe(overrides(layer)[old.id] ?? old.name);
        }
      });

      it('leaves no overrides, no derived fields and numbers 1..n', () => {
        for (const layer of dungeons(after)) {
          expect(layer).not.toHaveProperty('roomNameOverrides');
          for (const room of layer.rooms ?? []) {
            expect(room).not.toHaveProperty('boundary');
            expect(room).not.toHaveProperty('centroid');
            expect(room).not.toHaveProperty('area');
            expect(room).not.toHaveProperty('isPathway');
          }
          const numbers = (layer.rooms ?? []).map((r) => r.number).sort((a, b) => a! - b!);
          expect(numbers).toEqual(numbers.map((_, i) => i + 1));
        }
      });

      it('gives the map one level, named after it, holding every layer', () => {
        expect(after.levels).toHaveLength(1);
        expect(after.levels![0].name).toBe(before.mapSettings.name);
        for (const layer of after.layers) expect(layer.levelId).toBe(after.levels![0].id);
        expect(after.mapSettings.roomsVersion).toBe(2);
      });

      it('anchors every room inside a face of its own on the first refresh', () => {
        for (const layer of dungeons(after)) {
          const live = { ...layer, mergedFloor: computeMergedFloor(layer) };
          const { rooms } = syncRooms(live);
          for (const room of rooms) expect(room.orphaned, `${room.name} orphaned`).toBeUndefined();
          const faces = new Set(rooms.map((r) => JSON.stringify(r.face)));
          expect(faces.size).toBe(rooms.length);
        }
      });

      it('is idempotent', () => {
        const again = migrateRooms(after);
        expect(again).toBe(after);
      });
    });
  }

  it('numbers the warren 1..7 in reading order', async () => {
    const after = migrateRooms(await fixture('goblin-warren'));
    const rooms = dungeons(after)[0].rooms!;
    expect(rooms.map((r) => r.number).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const byNumber = [...rooms].sort((a, b) => a.number! - b.number!);
    for (let i = 1; i < byNumber.length; i++) {
      // Reading order: each next room starts on the same row or a lower one.
      expect(Math.floor(byNumber[i].anchor[1])).toBeGreaterThanOrEqual(Math.floor(byNumber[i - 1].anchor[1]) - 1);
    }
  });

  it('migrates through loadFromFile, so every path that opens a map gets it', async () => {
    useStore.getState().loadFromFile(await fixture('goblin-warren'));
    const state = useStore.getState();
    expect(state.levels).toHaveLength(1);
    expect(state.mapSettings.roomsVersion).toBe(2);
    expect(state.ui.activeLevelId).toBe(state.levels[0].id);
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    expect(layer.rooms).toHaveLength(7);
    expect(layer.rooms!.map((r) => r.name)).toContain('Warren Hall');
  });
});

describe('migrateRooms — legacy shapes', () => {
  const base = (layer: Record<string, unknown>, extra: Record<string, unknown> = {}): SerializedMapData =>
    ({
      version: '3.1',
      mapSettings: { name: 'Old', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000000' },
      grid: { visible: true, snapDivision: 2 },
      customImages: {},
      layers: [
        { id: 'bg', name: 'Background', type: 'background', visible: true, locked: false, opacity: 1 },
        {
          id: 'l1',
          name: 'Layer 1',
          type: 'dungeon',
          visible: true,
          locked: false,
          opacity: 1,
          children: [],
          standaloneWalls: [],
          mergedFloor: null,
          style: {},
          sublayerVisibility: { floor: true, grid: true, walls: true },
          ...layer,
        },
      ],
      ...extra,
    }) as unknown as SerializedMapData;

  it('turns a drawn room child into an anchored room and drops connectors', () => {
    const data = migrateRooms(
      base({
        children: [
          { id: 'drawn', name: 'Great Hall', childType: 'room', visible: true, contours: [[[0, 0], [10, 0], [10, 10], [0, 10]]] },
          // An L: its centroid falls outside, the anchor must not.
          {
            id: 'ell',
            name: 'Ell',
            childType: 'room',
            visible: true,
            contours: [[[20, 0], [30, 0], [30, 2], [22, 2], [22, 10], [20, 10]]],
            transform: { translate: [0, 20], rotate: 0, scale: [1, 1] },
          },
          { id: 'c1', name: 'Arch', childType: 'connector', visible: true, contours: [[[9, 4], [13, 4], [13, 6], [9, 6]]], kind: 'arch', state: 'open', isSecret: false },
          { id: 's1', name: 'Floor', childType: 'shape', visible: true, contours: [] },
        ],
        // The authored path mirrored the children into `rooms` under the same ids.
        rooms: [{ id: 'drawn', name: 'Great Hall', boundary: [], centroid: [5, 5], area: 100, isPathway: false }],
      }),
    );
    const layer = dungeons(data)[0];
    expect(layer.children.map((c) => c.id)).toEqual(['s1']);
    expect(layer.rooms!.map((r) => r.id)).toEqual(['drawn', 'ell']);
    expect(layer.rooms![0]).toMatchObject({ name: 'Great Hall', anchor: [5, 5] });
    const [x, y] = layer.rooms![1].anchor;
    // Inside the translated L.
    expect(x >= 20 && x <= 30 && y >= 20 && y <= 30).toBe(true);
    expect(x <= 22 || y <= 22).toBe(true);
  });

  it('gives a duplicate id a fresh uuid, first one keeps it', () => {
    const square = (x: number): [number, number][] => [[x, 0], [x + 4, 0], [x + 4, 4], [x, 4]];
    const data = migrateRooms(
      base({
        rooms: [
          { id: 'room-dup', name: 'A', boundary: square(0), centroid: [2, 2], area: 16, isPathway: false },
          { id: 'room-dup', name: 'B', boundary: square(10), centroid: [12, 2], area: 16, isPathway: false },
        ],
      }),
    );
    const rooms = dungeons(data)[0].rooms!;
    expect(rooms[0].id).toBe('room-dup');
    expect(rooms[1].id).not.toBe('room-dup');
    expect(rooms[1].name).toBe('B');
  });

  it('keeps existing levels and repairs a layer that names none', () => {
    const data = migrateRooms(
      base({ levelId: 'nope' }, { levels: [{ id: 'L', name: 'Ground' }], mapSettings: { name: 'X', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000', roomsVersion: 2 } }),
    );
    expect(data.levels).toEqual([{ id: 'L', name: 'Ground' }]);
    expect(data.layers.every((l) => l.levelId === 'L')).toBe(true);
    expect(needsRoomMigration(data)).toBe(false);
  });

  it('leaves a layer that never had rooms without a rooms key', () => {
    const data = migrateRooms(base({}));
    expect(dungeons(data)[0]).not.toHaveProperty('rooms');
  });
});
