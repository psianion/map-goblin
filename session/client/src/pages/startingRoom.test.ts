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
      { id: 'r-hall', label: '1 · Hall' },
      { id: 'r-vault', label: '2 · Vault' },
      { id: 'r-loose', label: 'Loose end' },
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
    expect(picker.rooms).toEqual([{ id: 'room-abc', label: 'Great Hall' }]);
  });
});
