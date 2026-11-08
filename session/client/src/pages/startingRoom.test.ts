import { describe, expect, it } from 'vitest';
import { startingRoomsOf } from './startingRoom';

const doc = (rooms: unknown[], mapSettings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mapSettings: { name: 'Crypt', ...mapSettings },
  layers: [{ id: 'l1', type: 'dungeon', rooms, ...extra }],
});

describe('the starting-room picker', () => {
  it('lists rooms by number, named the way the table names them', () => {
    const picker = startingRoomsOf(
      doc([
        { id: 'r-vault', name: 'Vault', number: 2, anchor: [15, 5] },
        { id: 'r-hall', name: 'Hall', number: 1, anchor: [5, 5] },
        { id: 'r-loose', name: 'Loose end', anchor: [25, 5] },
      ]),
    );
    expect(picker.rooms).toEqual([
      { id: 'r-hall', label: '1 · Hall', levelId: '', levelName: '' },
      { id: 'r-vault', label: '2 · Vault', levelId: '', levelName: '' },
      { id: 'r-loose', label: 'Loose end', levelId: '', levelName: '' },
    ]);
    expect(picker.defaultRoomId).toBe('');
  });

  it("defaults to the map's own starting room", () => {
    const rooms = [
      { id: 'r-hall', name: 'Hall', number: 1, anchor: [5, 5] },
      { id: 'r-vault', name: 'Vault', number: 2, anchor: [15, 5] },
    ];
    expect(startingRoomsOf(doc(rooms, { startingRoomId: 'r-vault' })).defaultRoomId).toBe('r-vault');
    // …unless it names a room the map no longer has: then the table starts dark, as before.
    expect(startingRoomsOf(doc(rooms, { startingRoomId: 'r-gone' })).defaultRoomId).toBe('');
  });

  it("reads an older file's names out of its override map", () => {
    const picker = startingRoomsOf(
      doc([{ id: 'room-abc', name: 'Room 1', boundary: [] }], {}, { roomNameOverrides: { 'room-abc': 'Great Hall' } }),
    );
    expect(picker.rooms).toEqual([{ id: 'room-abc', label: 'Great Hall', levelId: '', levelName: '' }]);
  });

  const threeRooms = (prefix: string) => [1, 2, 3].map((n) => ({ id: `${prefix}-${n}`, name: `Room ${n}`, number: n, anchor: [n * 5, 5] }));

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
    const byId = new Map(picker.rooms.map((r) => [r.id, r]));
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
