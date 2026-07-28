import { describe, it, expect } from 'vitest';
import { bindDoorToRooms } from './roomBinding';
import type { DoorChild, Room, WallSegment } from './types';

function makeDoor(overrides: Partial<DoorChild> = {}): DoorChild {
  return {
    id: 'door-1',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: 'wall-1',
    position: [5, 5],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...overrides,
  };
}

function makeWall(points: [number, number][], id = 'wall-1'): WallSegment {
  return { id, points, wallType: 'normal', direction: 'both', color: '#333333', width: 0.4, roughness: 0 };
}

function makeRoom(id: string, boundary: [number, number][]): Room {
  return { id, name: id, boundary, centroid: [0, 0], area: 0, isPathway: false };
}

const TOP = makeRoom('room-top', [[0, 0], [10, 0], [10, 5], [0, 5]]);
const BOTTOM = makeRoom('room-bottom', [[0, 5], [10, 5], [10, 10], [0, 10]]);

describe('bindDoorToRooms', () => {
  it('binds a door to the room on each side of its wall', () => {
    const result = bindDoorToRooms(makeDoor(), [makeWall([[0, 5], [10, 5]])], [TOP, BOTTOM]);
    expect(new Set([result.roomA, result.roomB])).toEqual(new Set(['room-top', 'room-bottom']));
  });

  it('reports null for an exterior side', () => {
    const result = bindDoorToRooms(makeDoor(), [makeWall([[0, 5], [10, 5]])], [TOP]);
    expect(new Set([result.roomA, result.roomB])).toEqual(new Set(['room-top', null]));
  });

  it('reports null on both sides when no room contains the probes', () => {
    const result = bindDoorToRooms(makeDoor(), [makeWall([[0, 5], [10, 5]])], []);
    expect(result).toEqual({ roomA: null, roomB: null });
  });

  it('works for a vertical wall', () => {
    const left = makeRoom('left', [[0, 0], [5, 0], [5, 10], [0, 10]]);
    const right = makeRoom('right', [[5, 0], [10, 0], [10, 10], [5, 10]]);
    const door = makeDoor({ position: [5, 5], angle: Math.PI / 2 });
    const result = bindDoorToRooms(door, [makeWall([[5, 0], [5, 10]])], [left, right]);
    expect(new Set([result.roomA, result.roomB])).toEqual(new Set(['left', 'right']));
  });

  it('uses the polyline segment nearest the door, not the first-to-last chord', () => {
    // L-shaped wall: the chord from (0,5) to (10,15) points diagonally, but the
    // door sits on the horizontal leg, so the probes must go straight up/down.
    const wall = makeWall([[0, 5], [10, 5], [10, 15]]);
    const result = bindDoorToRooms(makeDoor({ position: [5, 5] }), [wall], [TOP, BOTTOM]);
    expect(new Set([result.roomA, result.roomB])).toEqual(new Set(['room-top', 'room-bottom']));
  });

  it('falls back to the door angle when its wall is gone', () => {
    const door = makeDoor({ wallId: 'deleted', position: [5, 5], angle: 0 });
    const result = bindDoorToRooms(door, [], [TOP, BOTTOM]);
    expect(new Set([result.roomA, result.roomB])).toEqual(new Set(['room-top', 'room-bottom']));
  });

  it('honours a custom probe offset', () => {
    // A 0.1 offset stays inside the wall band of a thin corridor pair.
    const near = makeRoom('near', [[0, 5.5], [10, 5.5], [10, 10], [0, 10]]);
    const result = bindDoorToRooms(makeDoor(), [makeWall([[0, 5], [10, 5]])], [near], 0.1);
    expect(result).toEqual({ roomA: null, roomB: null });
    const wider = bindDoorToRooms(makeDoor(), [makeWall([[0, 5], [10, 5]])], [near], 1);
    expect(new Set([wider.roomA, wider.roomB])).toEqual(new Set(['near', null]));
  });
});
