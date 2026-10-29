import { describe, it, expect } from 'vitest';
import { buildRoomIndex, roomIndexOf } from './roomIndex';
import type { Room } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const room = (id: string, face: [number, number][], extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  anchor: face[0],
  face,
  ...extra,
});

describe('buildRoomIndex', () => {
  const rooms = [room('west', rect(0, 0, 10, 10)), room('east', rect(12, 0, 22, 10))];
  const index = buildRoomIndex(rooms, 1);

  it('answers the room a point is in, and null outside every room', () => {
    expect(index.roomAt(5, 5)?.id).toBe('west');
    expect(index.roomAt(20.5, 9.5)?.id).toBe('east');
    expect(index.roomAt(11, 5)).toBeNull();
    expect(index.roomAt(-50, 5)).toBeNull();
  });

  it('lists the cells whose centres a room covers', () => {
    expect(index.cellsOf('west')).toHaveLength(100);
    expect(index.cellsOf('west')).toContainEqual([0, 0]);
    expect(index.cellsOf('west')).not.toContainEqual([10, 0]);
    expect(index.cellsOf('nope')).toEqual([]);
  });

  it('prefers a live face over an orphan remembering the same ground', () => {
    const live = room('live', rect(0, 0, 10, 10));
    const ghost = room('ghost', rect(0, 0, 10, 10), { orphaned: true });
    expect(buildRoomIndex([ghost, live]).roomAt(5, 5)?.id).toBe('live');
  });

  it('reads a hand-traced boundary when a room has no derived face', () => {
    const traced: Room = { id: 't', name: 't', anchor: [1, 1], boundary: rect(0, 0, 4, 4) };
    expect(buildRoomIndex([traced]).roomAt(2, 2)?.id).toBe('t');
  });

  it('agrees with a brute-force walk on a grid of probes', () => {
    const many: Room[] = [];
    for (let i = 0; i < 6; i++) many.push(room(`r${i}`, rect(i * 7, (i % 2) * 5, i * 7 + 6, (i % 2) * 5 + 4.5)));
    const idx = buildRoomIndex(many);
    for (let x = -1; x < 45; x += 0.37) {
      for (let y = -1; y < 11; y += 0.41) {
        const brute = many.find((r) => {
          const [x0, y0] = r.face![0];
          const [x1, , ] = r.face![1];
          const y1 = r.face![2][1];
          return x > x0 && x < x1 && y > y0 && y < y1;
        });
        expect(idx.roomAt(x, y)?.id ?? null).toBe(brute?.id ?? null);
      }
    }
  });
});

describe('roomIndexOf', () => {
  it('builds once per rooms array', () => {
    const rooms = [room('a', rect(0, 0, 2, 2))];
    expect(roomIndexOf(rooms)).toBe(roomIndexOf(rooms));
    expect(roomIndexOf([...rooms])).not.toBe(roomIndexOf(rooms));
    expect(roomIndexOf(undefined).roomAt(1, 1)).toBeNull();
  });
});
