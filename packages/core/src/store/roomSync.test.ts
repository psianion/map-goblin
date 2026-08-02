import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from './store';
import { syncRooms } from './roomSync';
import { undoManager } from './undoManager';
import { PropertyCommand, UpdateWallCommand } from './commands';
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

/**
 * A v3.0 file from before rooms existed: a 10x10 floor split by one wall,
 * one door on that wall, and no `rooms` / `roomNameOverrides` fields at all.
 */
function fileWithoutRooms(): SerializedMapData {
  return {
    version: '3.0',
    mapSettings: {
      name: 'Old Map',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#2d2d44',
    },
    grid: { visible: true, snapDivision: 2, style: 'dotted' },
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        type: 'dungeon',
        visible: true,
        locked: false,
        opacity: 1,
        children: [structuredClone(DOOR)],
        standaloneWalls: [structuredClone(DIVIDER)],
        mergedFloor: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
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

describe('syncRooms — backfill on load', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(fileWithoutRooms());
  });

  it('a file saved without rooms arrives without them', () => {
    expect(dungeon().rooms).toBeUndefined();
  });

  it('detects the two rooms the wall divides the floor into', () => {
    syncRooms();
    const rooms = dungeon().rooms ?? [];
    expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      expect(room.area).toBeGreaterThan(20);
      expect(room.area).toBeLessThan(60);
    }
  });

  it('binds the door on the dividing wall to a room on each side', () => {
    syncRooms();
    const door = dungeon().children.find((c): c is DoorChild => c.childType === 'door');
    expect(door?.roomA).toBeTruthy();
    expect(door?.roomB).toBeTruthy();
    expect(door?.roomA).not.toBe(door?.roomB);
  });

  it('keeps a renamed room named across re-detection', () => {
    syncRooms();
    const target = (dungeon().rooms ?? [])[0];
    useStore.getState().renameRoom(dungeon().id, target.id, "Klarg's Cave");

    syncRooms();
    const after = (dungeon().rooms ?? []).find((r) => r.id === target.id);
    expect(after?.name).toBe("Klarg's Cave");
    expect(dungeon().roomNameOverrides?.[target.id]).toBe("Klarg's Cave");
  });

  it('leaves no rooms on a layer with no floor', () => {
    useStore.getState().resetToDefault();
    syncRooms();
    expect(dungeon().rooms).toEqual([]);
  });
});

/** The same v3.0 shell, with the layer's geometry swapped in. */
function mapWith(
  children: DoorChild[],
  standaloneWalls: WallSegment[],
  mergedFloor: [number, number][][],
): SerializedMapData {
  const file = fileWithoutRooms();
  const layer = file.layers[0] as unknown as DungeonLayer;
  layer.children = children;
  layer.standaloneWalls = standaloneWalls;
  layer.mergedFloor = mergedFloor;
  return file;
}

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

/**
 * Rooms are re-detected from geometry, so their ids carry no identity across an
 * edit — which side of the map they sit on does.
 */
function expectBoundTo(side: 'left' | 'right'): void {
  const bound = boundRooms();
  expect(bound).toHaveLength(2);
  for (const room of bound) {
    if (side === 'left') expect(room.centroid[0]).toBeLessThan(10);
    else expect(room.centroid[0]).toBeGreaterThan(10);
  }
}

describe('door rebinding after a geometry command', () => {
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

    beforeEach(() => {
      useStore.getState().loadFromFile(
        mapWith(
          [structuredClone(DOOR)],
          [{ ...structuredClone(DIVIDER), points: LEFT_SPAN }, structuredClone(CROSS)],
          [[[0, 0], [20, 0], [20, 10], [0, 10]]],
        ),
      );
      syncRooms();
    });

    function moveWall(): void {
      undoManager.execute(
        new UpdateWallCommand(dungeon().id, 'w1', { points: LEFT_SPAN }, { points: RIGHT_SPAN }),
      );
    }

    it('starts bound to the two rooms its wall divides', () => {
      expect(dungeon().rooms).toHaveLength(3);
      expectBoundTo('left');
    });

    it('rebinds to the rooms the moved wall now separates', () => {
      moveWall();
      expectBoundTo('right');
    });

    it('undo restores the previous binding with the geometry, redo re-applies both', () => {
      moveWall();

      undoManager.undo();
      expect(dungeon().standaloneWalls.find((w) => w.id === 'w1')?.points).toEqual(LEFT_SPAN);
      expectBoundTo('left');

      undoManager.redo();
      expect(dungeon().standaloneWalls.find((w) => w.id === 'w1')?.points).toEqual(RIGHT_SPAN);
      expectBoundTo('right');
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
      syncRooms();
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

    it('binds the floor side to a room and the other side to the exterior', () => {
      const door = theDoor();
      expect([door.roomA, door.roomB].filter((id) => id !== null)).toHaveLength(1);
      expect(boundRooms()[0].area).toBeGreaterThan(90);
    });

    it('rebinds to the room the floor edit left under it, and back on undo', () => {
      cutFloor();
      expect(dungeon().rooms).toHaveLength(2);
      expect(boundRooms()[0].area).toBeLessThan(50);

      undoManager.undo();
      expect(dungeon().rooms).toHaveLength(1);
      expect(boundRooms()[0].area).toBeGreaterThan(90);
    });
  });
});
