import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from './store';
import { syncRooms } from './roomSync';
import type { DungeonLayer, SerializedMapData } from './types';
import type { DoorChild, WallSegment } from '../shared/types';

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
        sublayerVisibility: { floor: true, grid: true, hatching: true, walls: true },
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
