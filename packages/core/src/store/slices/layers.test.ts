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
  number: 1,
  anchor: [5, 5],
};

describe('room store actions', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('starts with no rooms', () => {
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

  it('updateRoom merges a patch and removes keys set to undefined', () => {
    const id = dungeonLayer().id;
    useStore.getState().setRooms(id, [{ ...ROOM, areaId: 'a1' }]);
    useStore.getState().updateRoom(id, ROOM.id, { name: "Klarg's Cave", areaId: undefined });
    expect(dungeonLayer().rooms?.[0].name).toBe("Klarg's Cave");
    expect(dungeonLayer().rooms?.[0]).not.toHaveProperty('areaId');
    expect(dungeonLayer().rooms?.[0].number).toBe(1);
  });

  it('setThresholds and setAreas drop the key when emptied', () => {
    const id = dungeonLayer().id;
    useStore.getState().setThresholds(id, [{ id: 't1', points: [[0, 0], [1, 0]] }]);
    useStore.getState().setAreas(id, [{ id: 'a1', name: 'Crypt' }]);
    expect(dungeonLayer().thresholds).toHaveLength(1);
    expect(dungeonLayer().areas).toHaveLength(1);
    useStore.getState().setThresholds(id, []);
    useStore.getState().setAreas(id, []);
    expect(dungeonLayer()).not.toHaveProperty('thresholds');
    expect(dungeonLayer()).not.toHaveProperty('areas');
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

describe('setChildOrder', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  const light = (id: string): AnyChild => ({
    id, name: id, childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 0,
    intensity: 1, falloff: 'linear', position: { x: 0, y: 0 },
  });
  const order = () => dungeonLayer().children.map((c) => c.id);

  it('reorders the listed ids among their own slots and leaves the rest in place', () => {
    for (const id of ['a', 'b', 'c', 'd']) useStore.getState().addChild(dungeonLayer().id, light(id));
    useStore.getState().setChildOrder(dungeonLayer().id, ['d', 'ghost', 'b']);
    expect(order()).toEqual(['a', 'd', 'c', 'b']);
    useStore.getState().setChildOrder(dungeonLayer().id, ['b', 'c', 'd', 'a']);
    expect(order()).toEqual(['b', 'c', 'd', 'a']);
  });

  it('addChild inserts at an index and appends past the end', () => {
    for (const id of ['a', 'b']) useStore.getState().addChild(dungeonLayer().id, light(id));
    useStore.getState().addChild(dungeonLayer().id, light('x'), 0);
    useStore.getState().addChild(dungeonLayer().id, light('y'), 99);
    expect(order()).toEqual(['x', 'a', 'b', 'y']);
  });
});
