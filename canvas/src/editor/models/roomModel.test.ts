import { describe, it, expect } from 'vitest';
import type { DungeonLayer, Level, MapSettings, Room, RoomKey } from '@/store/types';
import { emptyRoomKey } from '@dnd/core/src/shared/prep';
import {
  areaPinLabel,
  byNumber,
  compassOf,
  doorsOnFace,
  halfMeta,
  hintText,
  isKeyEmpty,
  keySummary,
  layerOnLevel,
  otherHalfName,
  reorderIds,
  roomCountLabel,
  roomCountText,
  roomHintFor,
  roomMatches,
  sectionLabel,
  sectionLook,
  sheetGroups,
  WALL_KEYS,
  FLOOR_KEYS,
  MOOD_KEYS,
} from './roomModel';

const room = (id: string, over: Partial<Room> = {}): Room => ({ id, name: id, anchor: [0, 0], ...over });

function layer(over: Partial<DungeonLayer> = {}): DungeonLayer {
  return { id: 'l1', name: 'Dungeon', type: 'dungeon', levelId: 'lv', style: {}, children: [], rooms: [], ...over } as unknown as DungeonLayer;
}

const level: Level = { id: 'lv', name: 'Upper warren' };
const map = { ambientLight: '#000000' } as MapSettings;

describe('room order', () => {
  it('sorts by number with the unnumbered last, in insertion order', () => {
    const out = byNumber([room('c'), room('b', { number: 2 }), room('a', { number: 1 }), room('d')]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves a dragged id before or after its target, and says when nothing moved', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(reorderIds(['a', 'b', 'c'], 'a', 'b', 'before')).toBeNull();
    expect(reorderIds(['a', 'b', 'c'], 'a', 'a', 'after')).toBeNull();
    expect(reorderIds(['a', 'b'], 'x', 'a', 'after')).toBeNull();
  });
});

describe('keys', () => {
  const key = (over: Partial<RoomKey>): RoomKey => ({ ...emptyRoomKey('r'), ...over });

  it('an empty key is empty, a blank encounter too', () => {
    expect(isKeyEmpty(undefined)).toBe(true);
    expect(isKeyEmpty(key({}))).toBe(true);
    expect(isKeyEmpty(key({ encounter: { name: ' ', monsters: [] } }))).toBe(true);
    expect(isKeyEmpty(key({ traps: [{ id: 't', text: '' }] }))).toBe(false);
  });

  it('summarizes in one line: read-aloud first, else what the key holds', () => {
    expect(keySummary(undefined)).toBe('No read-aloud or notes yet.');
    expect(keySummary(key({ readAloud: 'A low hall.\nSecond line', notes: 'n' }))).toBe('A low hall.');
    expect(keySummary(key({ notes: 'x'.repeat(80) }))).toMatch(/^x{63}…$/);
    expect(
      keySummary(key({ encounter: { name: 'Guards', monsters: [{ id: 'm', name: 'Goblin', count: 2 }] }, checks: [{ id: 'c', ability: 'wis', dc: 12, text: '' }] })),
    ).toBe('Guards · 1 check');
  });

  it('filters by name, by number, and by anything in the key', () => {
    const r = room('r', { name: 'Warren hall', number: 2 });
    expect(roomMatches(r, undefined, '')).toBe(true);
    expect(roomMatches(r, undefined, 'warren')).toBe(true);
    expect(roomMatches(r, undefined, '2')).toBe(true);
    expect(roomMatches(r, undefined, '#2')).toBe(true);
    expect(roomMatches(r, undefined, '3')).toBe(false);
    expect(roomMatches(r, key({ treasure: 'a silvered dagger' }), 'dagger')).toBe(true);
    expect(roomMatches(r, key({ encounter: { name: '', monsters: [{ id: 'm', name: 'Goblin boss', count: 1 }] } }), 'boss')).toBe(true);
  });
});

describe('sheet groups', () => {
  it('is one list when the layer has no areas', () => {
    const l = layer({ rooms: [room('b', { number: 2 }), room('a', { number: 1 })] });
    const g = sheetGroups(l);
    expect(g).toHaveLength(1);
    expect(g[0].area).toBeNull();
    expect(g[0].rooms.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('groups by area in area order, then the rooms in none; an empty area stays unless filtering', () => {
    const l = layer({
      areas: [
        { id: 'up', name: 'Upper' },
        { id: 'low', name: 'Lower' },
        { id: 'empty', name: 'Empty' },
      ],
      rooms: [
        room('a', { number: 1, areaId: 'low' }),
        room('b', { number: 2, areaId: 'up' }),
        room('c', { number: 3 }),
        room('d', { number: 4, areaId: 'gone' }),
      ],
    });
    const g = sheetGroups(l);
    expect(g.map((x) => x.area?.id ?? null)).toEqual(['up', 'low', 'empty', null]);
    expect(g[3].rooms.map((r) => r.id)).toEqual(['c', 'd']);
    const filtered = sheetGroups(l, (r) => r.id === 'a');
    expect(filtered.map((x) => x.area?.id ?? null)).toEqual(['low']);
  });
});

describe('look labels', () => {
  const chain = (over: { layerStyle?: object; area?: object; room?: object; levelLook?: object } = {}) => ({
    map,
    level: { ...level, look: over.levelLook },
    layer: layer({ style: over.layerStyle ?? {} } as Partial<DungeonLayer>),
    area: over.area ? ({ id: 'ar', name: 'Lower dens', look: over.area } as never) : undefined,
    room: over.room ? ({ ...room('r'), look: over.room } as Room) : undefined,
  });

  it('reads Inherits Map, the level, the layer, the area, or Pinned', () => {
    expect(sectionLabel(sectionLook(chain(), 'level', FLOOR_KEYS), chain())).toBe('Inherits Map');
    const lv = chain({ levelLook: { floorTint: '#123456' } });
    expect(sectionLabel(sectionLook(lv, 'level', FLOOR_KEYS), lv)).toBe('Pinned');
    expect(sectionLabel(sectionLook(lv, 'room', FLOOR_KEYS), lv)).toBe('Inherits Upper warren');
    const ly = chain({ layerStyle: { wallWidth: 0.5 } });
    expect(sectionLabel(sectionLook(ly, 'room', WALL_KEYS), ly)).toBe('Inherits Dungeon');
    const ar = chain({ layerStyle: { wallWidth: 0.5 }, area: { wallTextureTint: '#ff0000' } });
    expect(sectionLabel(sectionLook(ar, 'room', WALL_KEYS), ar)).toBe('Inherits Lower dens');
    const rm = chain({ area: { wallTextureTint: '#ff0000' }, room: { wallWidth: 0.3 } });
    expect(sectionLook(rm, 'room', WALL_KEYS)).toEqual({ pinned: true, from: 'room' });
  });

  it('names the parent Mood really inherits: the map, or the level that pins it, never the layer', () => {
    const ly = chain({ layerStyle: { wallWidth: 0.5 } });
    expect(sectionLabel(sectionLook(ly, 'room', MOOD_KEYS), ly)).toBe('Inherits Map');
    expect(sectionLabel(sectionLook(ly, 'room', WALL_KEYS), ly)).toBe('Inherits Dungeon');
    const lv = chain({ levelLook: { mood: 'dim' } });
    expect(sectionLabel(sectionLook(lv, 'room', MOOD_KEYS), lv)).toBe('Inherits Upper warren');
  });

  it("names what an area header's group pins", () => {
    expect(areaPinLabel({ id: 'a', name: 'A' })).toBe('Inherits level');
    expect(areaPinLabel({ id: 'a', name: 'A', look: { wallTextureTint: '#000' } })).toBe('Walls pinned');
    expect(areaPinLabel({ id: 'a', name: 'A', look: { floorTint: '#000' } })).toBe('Floor pinned');
    expect(areaPinLabel({ id: 'a', name: 'A', look: { floorTint: '#000', wallWidth: 1 } })).toBe('Floor and walls pinned');
  });
});

describe('split naming', () => {
  const west: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const east: [number, number][] = [[4, 0], [10, 0], [10, 4], [4, 4]];
  const north: [number, number][] = [[0, -6], [4, -6], [4, 0], [0, 0]];

  it('says where a half lies from the other, the larger offset deciding', () => {
    expect(compassOf(west, east)).toBe('west');
    expect(compassOf(east, west)).toBe('east');
    expect(compassOf(north, west)).toBe('north');
    expect(compassOf(west, north)).toBe('south');
  });

  it('names the new half after the room, and counts the doors on each outline', () => {
    expect(otherHalfName('Warren hall', 'east')).toBe('Warren hall, east');
    expect(otherHalfName('  ', 'west')).toBe('Room, west');
    expect(doorsOnFace(east, [[10, 2], [4, 2], [20, 20]])).toBe(2);
    expect(halfMeta(east, 1)).toBe('24 sq · 1 door');
    expect(halfMeta(west, 2)).toBe('16 sq · 2 doors');
  });
});

describe('counts and levels', () => {
  it('reads rooms with areas, and the dock count with suggestions', () => {
    expect(roomCountLabel(5, 0)).toBe('5');
    expect(roomCountLabel(5, 2)).toBe('5 in 2 areas');
    expect(roomCountLabel(1, 1)).toBe('1 in 1 area');
    expect(roomCountText(1, 0)).toBe('1 room');
    expect(roomCountText(3, 2)).toBe('3 rooms · 2 suggested');
  });

  it('puts a layer with an unknown level on the first one', () => {
    const levels = [level, { id: 'lv2', name: 'Lower' }];
    expect(layerOnLevel(layer({ levelId: 'lv2' } as Partial<DungeonLayer>), levels, 'lv2')).toBe(true);
    expect(layerOnLevel(layer({ levelId: '' } as Partial<DungeonLayer>), levels, 'lv')).toBe(true);
    expect(layerOnLevel(layer(), [], 'anything')).toBe(true);
  });
});

describe('status hints', () => {
  const state = (over: Record<string, unknown>) =>
    ({
      ui: { roomSuggestions: null },
      tools: { activeTool: 'select' },
      selection: { selectedIds: [] },
      layers: [layer({ rooms: [room('r', { name: 'Warren hall', number: 2 })], areas: [{ id: 'ar', name: 'Upper' }] })],
      levels: [level],
      ...over,
    }) as never;

  it('says the exact lines for the room tools, a room, an area, a level and suggestions', () => {
    const line = (s: never) => {
      const h = roomHintFor(s);
      return h ? `${h.label} | ${hintText(h)}` : null;
    };
    expect(line(state({ tools: { activeTool: 'roomRect' } }))).toBe(
      'Rectangle room | drag to draw: the floor and its walls land together · Shift square · Esc cancel',
    );
    expect(line(state({ tools: { activeTool: 'divide' } }))).toBe(
      'Divide | drag across a floor: ends snap to the walls · Shift straight · Esc cancel',
    );
    expect(line(state({ selection: { selectedIds: ['r'] } }))).toBe(
      'Room 2 · Warren hall | Dbl-click reshape floor · Del delete room, keep floor · Esc deselect',
    );
    expect(line(state({ selection: { selectedIds: ['ar'] } }))).toBe('Area · Upper | 0 rooms · Esc deselect');
    expect(line(state({ selection: { selectedIds: ['lv'] } }))).toBe('Level · Upper warren | 1 layer, 1 room · Esc deselect');
    expect(line(state({ ui: { roomSuggestions: { layerId: 'l', rooms: [room('x')] } } }))).toBe(
      'Suggesting | enclosed floor with no room yet · Enter accept all · Esc dismiss',
    );
    expect(line(state({ selection: { selectedIds: ['r', 'r2'] }, layers: [layer({ rooms: [room('r'), room('r2')] })] }))).toBe(
      '2 rooms selected | Esc deselect',
    );
    expect(line(state({ selection: { selectedIds: ['r', 'ar'] } }))).toBeNull();
    expect(line(state({}))).toBeNull();
  });
});
