import { describe, it, expect } from 'vitest';
import { roomFloorFills } from './roomFillRenderer';
import { createDungeonLayer } from '../store/factories';
import type { DungeonLayer, Level, MapSettings, Room } from '../store/types';

/*
 * Which rooms get a floor fill: only those whose floor look comes from the room or its
 * area. A room that inherits from the layer or the level draws nothing of its own.
 */

const map = { name: 'M', ambientLight: '#2d2d44' } as MapSettings;
const level: Level = { id: 'lv', name: 'Level 1' };

const room = (id: string, extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  anchor: [1, 1],
  face: [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ],
  ...extra,
});

function layer(rooms: Room[], extra: Partial<DungeonLayer> = {}): DungeonLayer {
  const base = createDungeonLayer('L', 'lv');
  return { ...base, style: { ...base.style, floorColor: '#808080' }, rooms, ...extra };
}

describe('roomFloorFills', () => {
  it('a room with no look, or a look that pins no floor key, gets no fill', () => {
    const fills = roomFloorFills({ mapSettings: map, levels: [level] }, layer([room('a'), room('b', { look: { wallTextureTint: '#ff0000' } })]));
    expect(fills.size).toBe(0);
  });

  it('a tint pinned on the room multiplies over the floor; a texture pinned paints it', () => {
    const fills = roomFloorFills(
      { mapSettings: map, levels: [level] },
      layer([
        room('tinted', { look: { floorTint: '#ff8000' } }),
        room('tiled', { look: { floorTextureId: 'pack:stone', floorTint: '#00ff00' } }),
        room('bare', { look: { floorTextureId: '', floorTint: '#808080' } }),
      ]),
    );
    expect(fills.get('tinted')).toEqual({ kind: 'tint', color: 0xff8000 });
    expect(fills.get('tiled')).toEqual({ kind: 'texture', textureId: 'pack:stone', tint: '#00ff00' });
    // Pinned to no texture: the floor colour in the room's tint (0x80 × 0x80 / 0xff).
    expect(fills.get('bare')).toEqual({ kind: 'solid', color: 0x404040 });
  });

  it("an area's floor pin fills its rooms; a level's does not count as the room's own", () => {
    const fills = roomFloorFills(
      { mapSettings: map, levels: [{ ...level, look: { floorTint: '#123456' } }] },
      layer([room('inArea', { areaId: 'w' }), room('loose')], { areas: [{ id: 'w', name: 'Wing', look: { floorTint: '#ff0000' } }] }),
    );
    expect(fills.get('inArea')).toEqual({ kind: 'tint', color: 0xff0000 });
    expect(fills.has('loose')).toBe(false);
  });
});
