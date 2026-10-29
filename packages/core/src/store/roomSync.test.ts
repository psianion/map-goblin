import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from './store';
import { syncRooms } from './roomSync';
import { refreshRooms } from './roomRefresh';
import { undoManager } from './undoManager';
import { AddThresholdCommand, PropertyCommand, SetRoomAnchorCommand, UpdateWallCommand } from './commands';
import { FLOOR_ANCHORED } from '../shared/wallResolve';
import type { DungeonLayer, SerializedMapData } from './types';
import type { DoorChild, Room, WallSegment } from '../shared/types';

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

const DIVIDER: WallSegment = {
  id: 'w1',
  points: [[0, 5], [10, 5]],
  wallType: 'normal',
  direction: 'both',
  color: '#333333',
  width: 0.4,
  roughness: 0,
};

const DOOR: DoorChild = {
  id: 'd1',
  name: 'Single 1',
  childType: 'door',
  visible: true,
  wallId: 'w1',
  position: [5, 5],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
};

const room = (id: string, anchor: [number, number], extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  anchor,
  ...extra,
});

/** A migrated document holding one dungeon layer with the given geometry and rooms. */
function mapWith(
  rooms: Room[],
  children: DoorChild[],
  standaloneWalls: WallSegment[],
  mergedFloor: [number, number][][],
): SerializedMapData {
  return {
    version: '3.1',
    mapSettings: {
      name: 'Rooms',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#2d2d44',
      roomsVersion: 2,
    },
    levels: [{ id: 'lvl', name: 'Rooms' }],
    grid: { visible: true, snapDivision: 2 },
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        type: 'dungeon',
        levelId: 'lvl',
        visible: true,
        locked: false,
        opacity: 1,
        children,
        standaloneWalls,
        mergedFloor,
        rooms,
        style: {},
        sublayerVisibility: { floor: true, grid: true, walls: true },
      },
    ],
  } as unknown as SerializedMapData;
}

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function layerOf(rooms: Room[], walls: WallSegment[], floor: [number, number][][], children: DoorChild[] = []): DungeonLayer {
  return (mapWith(rooms, children, walls, floor).layers[0] as DungeonLayer);
}

const SQUARE10: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];

describe('syncRooms — pure face refresh', () => {
  it('gives each room the face its anchor sits in', () => {
    const { rooms } = syncRooms(layerOf([room('top', [5, 2]), room('bottom', [5, 8])], [DIVIDER], SQUARE10));
    expect(rooms.map((r) => r.id)).toEqual(['top', 'bottom']);
    for (const r of rooms) {
      expect(r.orphaned).toBeUndefined();
      expect(r.area).toBeGreaterThan(40);
      expect(r.area).toBeLessThan(50);
    }
    expect(rooms[0].centroid![1]).toBeLessThan(5);
    expect(rooms[1].centroid![1]).toBeGreaterThan(5);
  });

  it('never creates or drops a room: a face nobody anchored stays roomless', () => {
    const { rooms } = syncRooms(layerOf([room('top', [5, 2])], [DIVIDER], SQUARE10));
    expect(rooms).toHaveLength(1);
    expect(syncRooms(layerOf([], [DIVIDER], SQUARE10)).rooms).toEqual([]);
  });

  it('flags an anchor on no face as orphaned and keeps the face it had', () => {
    const face: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const { rooms } = syncRooms(layerOf([room('lost', [50, 50], { face })], [], SQUARE10));
    expect(rooms[0].orphaned).toBe(true);
    expect(rooms[0].face).toEqual(face);
  });

  it('lets two anchors share one face, unmerged', () => {
    const { rooms } = syncRooms(layerOf([room('a', [2, 2]), room('b', [8, 8])], [], SQUARE10));
    expect(rooms).toHaveLength(2);
    expect(rooms[0].face).toEqual(rooms[1].face);
  });

  it('takes a hand-traced boundary as the face on a map with no floor', () => {
    const boundary: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const { rooms } = syncRooms(layerOf([room('traced', [2, 2], { boundary })], [], []));
    expect(rooms[0].face).toEqual(boundary);
    expect(rooms[0].area).toBeCloseTo(16);
    expect(rooms[0].orphaned).toBeUndefined();
  });

  it('cuts faces along thresholds', () => {
    const layer = layerOf([room('top', [5, 2]), room('bottom', [5, 8])], [], SQUARE10);
    layer.thresholds = [{ id: 't', points: [[0, 5], [10, 5]] }];
    const { rooms } = syncRooms(layer);
    expect(rooms[0].face).not.toEqual(rooms[1].face);
    expect(rooms[0].area).toBeCloseTo(49.5, 0);
  });

  it('binds doors and lists them on their rooms', () => {
    const { rooms, doorRooms } = syncRooms(
      layerOf([room('top', [5, 2]), room('bottom', [5, 8])], [DIVIDER], SQUARE10, [structuredClone(DOOR)]),
    );
    const bound = doorRooms.get('d1')!;
    expect(new Set([bound.roomA, bound.roomB])).toEqual(new Set(['top', 'bottom']));
    expect(rooms[0].doors).toEqual(['d1']);
    expect(rooms[1].doors).toEqual(['d1']);
  });

  it('hands back the same array when nothing moved, so the store sees no write', () => {
    const layer = layerOf([room('top', [5, 2]), room('bottom', [5, 8])], [DIVIDER], SQUARE10);
    const first = syncRooms(layer);
    expect(first.changed).toBe(true);
    const again = syncRooms({ ...layer, rooms: first.rooms });
    expect(again.changed).toBe(false);
    expect(again.rooms).toBe(first.rooms);
  });

  it('indexes the rooms it placed', () => {
    const { index } = syncRooms(layerOf([room('top', [5, 2]), room('bottom', [5, 8])], [DIVIDER], SQUARE10));
    expect(index.roomAt(5, 1)?.id).toBe('top');
    expect(index.roomAt(5, 9)?.id).toBe('bottom');
    expect(index.roomAt(50, 50)).toBeNull();
  });
});

function theDoor(): DoorChild {
  const door = dungeon().children.find((c): c is DoorChild => c.childType === 'door');
  if (!door) throw new Error('no door');
  return door;
}

/** The rooms the door is currently bound to; an exterior side drops out. */
function boundRooms(): Room[] {
  const rooms = dungeon().rooms ?? [];
  const door = theDoor();
  return [door.roomA, door.roomB]
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is Room => r !== undefined);
}

describe('refreshRooms — the store side', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
  });

  describe('wall node edit', () => {
    // A 20x10 floor halved by a cross wall at x=10. The door's wall starts as
    // the left half's divider and is moved to divide the right half instead.
    const CROSS: WallSegment = { ...DIVIDER, id: 'w2', points: [[10, 0], [10, 10]] };
    const LEFT_SPAN: [number, number][] = [[0, 5], [10, 5]];
    const RIGHT_SPAN: [number, number][] = [[10, 5], [20, 5]];
    const ROOMS = [
      room('nw', [5, 2.5]),
      room('sw', [5, 7.5]),
      room('ne', [15, 2.5]),
      room('se', [15, 7.5]),
    ];

    beforeEach(() => {
      useStore.getState().loadFromFile(
        mapWith(
          ROOMS,
          [structuredClone(DOOR)],
          [{ ...structuredClone(DIVIDER), points: LEFT_SPAN }, structuredClone(CROSS)],
          [[[0, 0], [20, 0], [20, 10], [0, 10]]],
        ),
      );
      refreshRooms();
    });

    function moveWall(): void {
      undoManager.execute(
        new UpdateWallCommand(dungeon().id, 'w1', { points: LEFT_SPAN }, { points: RIGHT_SPAN }),
      );
    }

    const ids = () => boundRooms().map((r) => r.id).sort();

    it('starts bound to the two rooms its wall divides', () => {
      expect(ids()).toEqual(['nw', 'sw']);
    });

    it('rebinds to the rooms the moved wall now separates, and no room id changes', () => {
      moveWall();
      expect(ids()).toEqual(['ne', 'se']);
      expect((dungeon().rooms ?? []).map((r) => r.id)).toEqual(['nw', 'sw', 'ne', 'se']);
    });

    it('undo restores the previous binding with the geometry, redo re-applies both', () => {
      moveWall();
      undoManager.undo();
      expect(dungeon().standaloneWalls.find((w) => w.id === 'w1')?.points).toEqual(LEFT_SPAN);
      expect(ids()).toEqual(['nw', 'sw']);
      undoManager.redo();
      expect(ids()).toEqual(['ne', 'se']);
    });
  });

  describe('floor outline edit', () => {
    const WHOLE: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const SPLIT: [number, number][][] = [
      [[0, 0], [4, 0], [4, 10], [0, 10]],
      [[6, 0], [10, 0], [10, 10], [6, 10]],
    ];

    beforeEach(() => {
      useStore.getState().loadFromFile(
        mapWith(
          [room('hall', [2, 5])],
          [
            {
              ...structuredClone(DOOR),
              wallId: FLOOR_ANCHORED,
              position: [0, 5],
              // Deliberately wrong for the vertical edge this door sits on:
              // the binding has to come from the resolver, not this field.
              angle: 0,
            },
          ],
          [],
          WHOLE,
        ),
      );
      refreshRooms();
    });

    function cutFloor(): void {
      undoManager.execute(
        new PropertyCommand(
          'Cut floor',
          { type: 'layer', layerId: dungeon().id },
          { mergedFloor: WHOLE },
          { mergedFloor: SPLIT },
        ),
      );
    }

    it('binds the floor side to the room and the other side to the exterior', () => {
      const door = theDoor();
      expect([door.roomA, door.roomB].filter((id) => id !== null)).toEqual(['hall']);
      expect(boundRooms()[0].area).toBeGreaterThan(90);
    });

    it('reshapes the room with the floor under its anchor, and back on undo', () => {
      cutFloor();
      expect(dungeon().rooms).toHaveLength(1);
      expect(dungeon().rooms![0].id).toBe('hall');
      expect(dungeon().rooms![0].area).toBeLessThan(50);

      undoManager.undo();
      expect(dungeon().rooms![0].area).toBeGreaterThan(90);
    });
  });

  describe('anchors and thresholds', () => {
    beforeEach(() => {
      useStore.getState().loadFromFile(mapWith([room('a', [2, 2]), room('b', [8, 8])], [], [], SQUARE10));
      refreshRooms();
    });

    it('a threshold splits the shared face; undo joins it again', () => {
      const shared = dungeon().rooms!.map((r) => r.face);
      expect(shared[0]).toEqual(shared[1]);
      undoManager.execute(
        new AddThresholdCommand(dungeon().id, { id: 't', points: [[0, 5], [10, 5]] }),
      );
      const [a, b] = dungeon().rooms!;
      expect(a.face).not.toEqual(b.face);
      expect(a.area).toBeLessThan(50);
      undoManager.undo();
      expect(dungeon().rooms![0].face).toEqual(dungeon().rooms![1].face);
    });

    it('moving an anchor off the floor orphans the room; undo brings it back', () => {
      undoManager.execute(new SetRoomAnchorCommand(dungeon().id, 'a', [40, 40]));
      expect(dungeon().rooms![0].orphaned).toBe(true);
      undoManager.undo();
      expect(dungeon().rooms![0].orphaned).toBeUndefined();
      expect(dungeon().rooms![0].anchor).toEqual([2, 2]);
    });

    it('a refresh that changes nothing writes nothing', () => {
      const before = dungeon().rooms;
      refreshRooms();
      expect(dungeon().rooms).toBe(before);
    });
  });
});
