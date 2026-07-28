import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import type { DungeonLayer, Room } from '../types';

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
