import { describe, expect, it } from 'vitest';
import { startingRoomsOf } from './startingRoom';

/** A room's ring as the server sends it: a square round its anchor. */
const ring = (x: number, y: number): [number, number][] => [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]];
const room = (id: string, name: string, at: [number, number], number?: number) => ({ id, name, anchor: at, boundary: ring(...at), ...(number === undefined ? {} : { number }) });
/** The picker's rooms without their outlines, which these tests do not read. */
const listed = (rooms: { outline?: unknown }[]) => rooms.map(({ outline: _outline, ...rest }) => rest);

const doc = (rooms: unknown[], mapSettings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mapSettings: { name: 'Crypt', ...mapSettings },
  layers: [{ id: 'l1', type: 'dungeon', rooms, ...extra }],
});

describe('the starting-room picker', () => {
  it('lists rooms by number, named the way the table names them', () => {
    const picker = startingRoomsOf(
      doc([
        room('r-vault', 'Vault', [15, 5], 2),
        room('r-hall', 'Hall', [5, 5], 1),
        room('r-loose', 'Loose end', [25, 5]),
      ]),
    );
    expect(listed(picker.rooms)).toEqual([
      { id: 'r-hall', label: '1 · Hall', levelId: '', levelName: '' },
      { id: 'r-vault', label: '2 · Vault', levelId: '', levelName: '' },
      { id: 'r-loose', label: 'Loose end', levelId: '', levelName: '' },
    ]);
    expect(picker.defaultRoomId).toBe('');
  });

  it("defaults to the map's own starting room", () => {
    const rooms = [
      room('r-hall', 'Hall', [5, 5], 1),
      room('r-vault', 'Vault', [15, 5], 2),
    ];
    expect(startingRoomsOf(doc(rooms, { startingRoomId: 'r-vault' })).defaultRoomId).toBe('r-vault');
    // …unless it names a room the map no longer has: then the table starts dark, as before.
    expect(startingRoomsOf(doc(rooms, { startingRoomId: 'r-gone' })).defaultRoomId).toBe('');
  });

  it('leaves out a room with no shape, and never starts the table in one', () => {
    const rooms = [room('r-hall', 'Hall', [5, 5], 1), { id: 'r-open', name: 'Open yard', number: 2, anchor: [15, 5], boundary: [] }];
    const picker = startingRoomsOf(doc(rooms, { startingRoomId: 'r-open' }));
    expect(picker.rooms.map((r) => r.id)).toEqual(['r-hall']);
    expect(picker.rooms[0].outline).toHaveLength(4);
    expect(picker.defaultRoomId).toBe('');
  });

  it("reads an older file's names out of its override map", () => {
    const picker = startingRoomsOf(
      doc([{ id: 'room-abc', name: 'Room 1', boundary: ring(5, 5) }], {}, { roomNameOverrides: { 'room-abc': 'Great Hall' } }),
    );
    expect(listed(picker.rooms)).toEqual([{ id: 'room-abc', label: 'Great Hall', levelId: '', levelName: '' }]);
  });

  const threeRooms = (prefix: string) => [1, 2, 3].map((n) => room(`${prefix}-${n}`, `Room ${n}`, [n * 5, 5], n));

  it('tags each room of a two-level map with its level', () => {
    const picker = startingRoomsOf({
      mapSettings: { name: 'Keep' },
      levels: [
        { id: 'lv-ground', name: 'Ground' },
        { id: 'lv-cellar', name: 'Cellar' },
      ],
      layers: [
        { id: 'l1', type: 'dungeon', levelId: 'lv-ground', rooms: threeRooms('g') },
        { id: 'l2', type: 'dungeon', levelId: 'lv-cellar', rooms: threeRooms('c') },
      ],
    });
    expect(picker.rooms).toHaveLength(6);
    expect(picker.levels).toEqual([
      { id: 'lv-ground', name: 'Ground' },
      { id: 'lv-cellar', name: 'Cellar' },
    ]);
    const byId = new Map(listed(picker.rooms).map((r) => [(r as { id: string }).id, r]));
    for (const n of [1, 2, 3]) {
      expect(byId.get(`g-${n}`)).toEqual({ id: `g-${n}`, label: `${n} · Room ${n}`, levelId: 'lv-ground', levelName: 'Ground' });
      expect(byId.get(`c-${n}`)).toEqual({ id: `c-${n}`, label: `${n} · Room ${n}`, levelId: 'lv-cellar', levelName: 'Cellar' });
    }
  });

  it('lists a one-level map as before, every room on that level', () => {
    const picker = startingRoomsOf({
      mapSettings: { name: 'Crypt' },
      levels: [{ id: 'lv-1', name: 'Level 1' }],
      layers: [{ id: 'l1', type: 'dungeon', levelId: 'lv-gone', rooms: threeRooms('r') }],
    });
    expect(picker.rooms.map((r) => r.label)).toEqual(['1 · Room 1', '2 · Room 2', '3 · Room 3']);
    expect(picker.rooms.every((r) => r.levelId === 'lv-1' && r.levelName === 'Level 1')).toBe(true);
  });
});
