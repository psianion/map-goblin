import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import type { AnyChild, DungeonLayer, Room } from '../types';

function dungeonLayer(): DungeonLayer {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon');
  if (!layer) throw new Error('default state has no dungeon layer');
  return layer;
}

const ROOM: Room = {
  id: 'room-abc',
  name: 'Room 1',
  boundary: [[0, 0], [10, 0], [10, 10], [0, 10]],
  centroid: [5, 5],
  area: 100,
  isPathway: false,
};

describe('room store actions', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('starts with no rooms detected', () => {
    expect(dungeonLayer().rooms).toBeUndefined();
  });

  it('setRooms stores rooms on the dungeon layer', () => {
    useStore.getState().setRooms(dungeonLayer().id, [ROOM]);
    expect(dungeonLayer().rooms).toHaveLength(1);
    expect(dungeonLayer().rooms?.[0].name).toBe('Room 1');
  });

  it('setRooms ignores unknown layers', () => {
    useStore.getState().setRooms('nope', [ROOM]);
    expect(dungeonLayer().rooms).toBeUndefined();
  });

  it('renameRoom updates the room and records an override', () => {
    const id = dungeonLayer().id;
    useStore.getState().setRooms(id, [ROOM]);
    useStore.getState().renameRoom(id, ROOM.id, "Klarg's Cave");
    expect(dungeonLayer().rooms?.[0].name).toBe("Klarg's Cave");
    expect(dungeonLayer().roomNameOverrides?.[ROOM.id]).toBe("Klarg's Cave");
  });

  it('renameRoom records an override even before the room is detected', () => {
    // The override is the durable record — re-detection reads it back.
    useStore.getState().renameRoom(dungeonLayer().id, 'room-xyz', 'Goblin Den');
    expect(dungeonLayer().roomNameOverrides?.['room-xyz']).toBe('Goblin Den');
  });
});

describe('reorderChild bounds guard', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  function makeShape(id: string): AnyChild {
    return {
      id,
      name: id,
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    } as AnyChild;
  }

  it.each([
    [-1, 0],
    [0, -1],
    [0, 5],
    [5, 0],
    [1.5, 0],
    [0, 1.5],
  ])('is a no-op for out-of-range indices (%i -> %i)', (fromIndex, toIndex) => {
    const layer = dungeonLayer();
    useStore.getState().addChild(layer.id, makeShape('c1'));
    useStore.getState().addChild(layer.id, makeShape('c2'));
    const before = dungeonLayer().children.map((c) => c.id);

    useStore.getState().reorderChild(layer.id, fromIndex, toIndex);

    expect(dungeonLayer().children.map((c) => c.id)).toEqual(before);
  });
});
