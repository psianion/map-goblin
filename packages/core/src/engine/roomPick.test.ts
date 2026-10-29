import { describe, it, expect, afterEach } from 'vitest';
import { hitTestRoom, pickInLayer, roomBadgeAt, setRoomPicking, ROOM_BADGE_RADIUS_PX } from './hitTest';
import { createDungeonLayer } from '../store/factories';
import type { DungeonLayer, Room, ShapeChild } from '../store/types';
import type { AssetChild } from '../shared/types';

/*
 * Rooms pick after whatever stands on the floor (props, doors, walls, lights) and
 * before the floor itself, and only where a host turned room picking on.
 */

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function floor(): ShapeChild {
  return {
    id: 'floor',
    name: 'Floor',
    childType: 'shape',
    shapeType: 'rectangle',
    visible: true,
    contours: [square(0, 0, 20, 10)],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  } as ShapeChild;
}

function prop(): AssetChild {
  return {
    id: 'crate',
    name: 'Crate',
    childType: 'asset',
    visible: true,
    assetId: 'x',
    position: { x: 3, y: 3 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
  } as AssetChild;
}

function layerWithRooms(): DungeonLayer {
  const layer = createDungeonLayer('L', 'level');
  const west: Room = { id: 'west', name: 'West', number: 1, anchor: [5, 5], face: square(0, 0, 10, 10) };
  const east: Room = { id: 'east', name: 'East', number: 2, anchor: [15, 5], face: square(10, 0, 20, 10) };
  // An orphan keeps no live face: only its badge picks it.
  const lost: Room = { id: 'lost', name: 'Lost', anchor: [30, 30], orphaned: true };
  return { ...layer, children: [floor(), prop()], rooms: [west, east, lost] };
}

afterEach(() => setRoomPicking(false));

describe('room picking', () => {
  it('is off by default: a click in a room takes the floor', () => {
    const hit = pickInLayer(layerWithRooms(), [6, 6]);
    expect(hit?.kind).toBe('child');
    expect(hit?.id).toBe('floor');
  });

  it('when on, a click in a room takes the room, ahead of the floor', () => {
    setRoomPicking(true);
    const hit = pickInLayer(layerWithRooms(), [16, 6]);
    expect(hit).toMatchObject({ kind: 'room', id: 'east' });
  });

  it('a prop standing in the room still wins', () => {
    setRoomPicking(true);
    expect(pickInLayer(layerWithRooms(), [3, 3])?.id).toBe('crate');
  });

  it('follows its predicate (the overlay switch), and opts.rooms overrides it', () => {
    let on = false;
    setRoomPicking(() => on);
    expect(pickInLayer(layerWithRooms(), [6, 6])?.kind).toBe('child');
    on = true;
    expect(pickInLayer(layerWithRooms(), [6, 6])?.kind).toBe('room');
    expect(pickInLayer(layerWithRooms(), [6, 6], { rooms: false })?.kind).toBe('child');
  });

  it('a badge picks its room even with no face under it', () => {
    const layer = layerWithRooms();
    const zoom = 20;
    const near = 30 + (ROOM_BADGE_RADIUS_PX - 1) / zoom;
    expect(roomBadgeAt(layer, [near, 30], zoom)?.id).toBe('lost');
    expect(roomBadgeAt(layer, [32, 30], zoom)).toBeNull();
    expect(hitTestRoom(layer, [near, 30], { zoom })?.id).toBe('lost');
    expect(hitTestRoom(layer, [near, 30])).toBeNull();
  });
});
