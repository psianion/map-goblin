import { describe, it, expect } from 'vitest';
import {
  DARK_LUMA,
  SKY_SHARE,
  SLIDER_WEIGHT,
  isDarkRegion,
  levelGrade,
  levelPlace,
  regionDarkness,
  regionGrade,
  regionLight,
  roomPlace,
} from './regionGrade';
import { skyFrame } from './sky';
import { TIMES } from './prep';
import { darkTest, layersOnLevel, levelIdOf, onLevel } from './visionGate';
import type { DungeonLayer, MapSettings } from '../store/types';
import type { Level, Room } from './types';

const NOON_SKY = skyFrame({ environment: 'outdoor', time: 'day' });
const NIGHT_SKY = skyFrame({ environment: 'outdoor', time: 'night' });
const WHITE = '#ffffff';

describe('regionGrade with a time of day tinted on its own', () => {
  const tints = { night: '#ff0000' };

  it('a red Night draws in red, not in the map tint', () => {
    const red = regionGrade({ place: 'outdoor', tint: WHITE }, skyFrame({ environment: 'outdoor', time: 'night', timeTints: tints }));
    const plain = regionGrade({ place: 'outdoor', tint: WHITE }, NIGHT_SKY);
    expect(red).not.toBe(plain);
    // Red only: the green and blue channels go to nothing.
    expect(red.slice(3)).toBe('0000');
    expect(plain.slice(3)).not.toBe('0000');
  });

  it('Day is untouched by Night’s tint', () => {
    const day = skyFrame({ environment: 'outdoor', time: 'day', timeTints: tints });
    expect(regionGrade({ place: 'outdoor', tint: '#aabbcc' }, day)).toBe(regionGrade({ place: 'outdoor', tint: '#aabbcc' }, NOON_SKY));
    expect(regionGrade({ place: 'outdoor', tint: '#aabbcc' }, day)).toBe('#aabbcc');
  });
});

describe('regionGrade: three places × two skies', () => {
  it('an Outdoor region at noon is its tint, untouched', () => {
    expect(regionGrade({ place: 'outdoor', tint: '#aabbcc' }, NOON_SKY)).toBe('#aabbcc');
  });

  it('an Indoor region at noon gets 40 % of the sky: darker than Outdoor, lighter than Underground', () => {
    const outdoor = regionLight('outdoor', NOON_SKY);
    const indoor = regionLight('indoor', NOON_SKY);
    const underground = regionLight('underground', NOON_SKY);
    expect(indoor).toBeLessThan(outdoor);
    expect(underground).toBeLessThan(indoor);
  });

  it('an Underground region is near-black at noon, the tint still there', () => {
    const g = regionGrade({ place: 'underground', tint: '#ff8040' }, NOON_SKY);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
    expect(r).toBeLessThan(60);
    expect(r).toBeGreaterThan(b!);
    expect(gg).toBeGreaterThan(b!);
  });

  it('an Outdoor region at night is near-black', () => {
    expect(regionLight('outdoor', NIGHT_SKY)).toBeLessThan(DARK_LUMA);
  });

  it('every place is darker at night than at noon', () => {
    for (const place of ['outdoor', 'indoor'] as const) expect(regionLight(place, NIGHT_SKY)).toBeLessThan(regionLight(place, NOON_SKY));
    expect(regionLight('underground', NIGHT_SKY)).toBeLessThanOrEqual(regionLight('underground', NOON_SKY));
  });

  it('Indoor lies between Outdoor and Underground, channel by channel, at every time of day', () => {
    const channels = (g: string) => [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
    for (const time of TIMES) {
      const sky = skyFrame({ environment: 'outdoor', time });
      const [outdoor, indoor, underground] = (['outdoor', 'indoor', 'underground'] as const).map((place) =>
        channels(regionGrade({ place, tint: WHITE }, sky)),
      );
      for (let i = 0; i < 3; i++) {
        expect(indoor![i]).toBeGreaterThanOrEqual(Math.min(outdoor![i]!, underground![i]!));
        expect(indoor![i]).toBeLessThanOrEqual(Math.max(outdoor![i]!, underground![i]!));
      }
    }
  });

  it('the slider at 1 goes near-black without erasing the tint (SLIDER_WEIGHT)', () => {
    const black = skyFrame({ environment: 'outdoor', time: 'day', override: 1 });
    expect(regionLight('outdoor', black)).toBeCloseTo(1 - SLIDER_WEIGHT, 2);
    expect(regionGrade({ place: 'outdoor', tint: WHITE }, black)).not.toBe('#000000');
  });
});

describe('isDarkRegion', () => {
  it('turns on below DARK_LUMA and only then', () => {
    expect(isDarkRegion('outdoor', NOON_SKY)).toBe(false);
    expect(isDarkRegion('underground', NOON_SKY)).toBe(true);
    expect(isDarkRegion('outdoor', NIGHT_SKY)).toBe(true);
    expect(regionLight('indoor', NOON_SKY)).toBeGreaterThan(DARK_LUMA);
  });

  it('the slider at 1 makes every region dark, at 0.5 an Outdoor one stays visible', () => {
    expect(isDarkRegion('outdoor', skyFrame({ time: 'day', override: 1 }))).toBe(true);
    expect(isDarkRegion('outdoor', skyFrame({ time: 'day', override: 0.5 }))).toBe(false);
  });
});

describe('levels and the chain', () => {
  const map = { ambientLight: '#808080', environment: 'underground' } as MapSettings;

  it('a level with no look falls back to the map: its environment is its place', () => {
    expect(levelPlace(map, undefined)).toBe('underground');
    expect(levelPlace(map, { look: { place: 'outdoor' } })).toBe('outdoor');
    expect(levelGrade(map, undefined, NOON_SKY)).toBe(regionGrade({ place: 'underground', tint: '#808080' }, NOON_SKY));
  });

  it('a room resolves room ?? area ?? level ?? map', () => {
    const layer = { id: 'l', type: 'dungeon', style: {}, areas: [{ id: 'a', name: 'A', look: { place: 'outdoor' } }] } as unknown as DungeonLayer;
    const room = { id: 'r', name: 'R', anchor: [0, 0], areaId: 'a' } as Room;
    expect(roomPlace({ mapSettings: map, levels: [] }, layer, room)).toBe('outdoor');
    expect(roomPlace({ mapSettings: map, levels: [] }, layer, { ...room, look: { place: 'indoor' } })).toBe('indoor');
  });

  it('memoizes: the same region and sky answer the same string', () => {
    const a = regionGrade({ place: 'indoor', tint: '#445566' }, NOON_SKY);
    expect(regionGrade({ place: 'indoor', tint: '#445566' }, { ...NOON_SKY })).toBe(a);
    expect(SKY_SHARE).toEqual({ outdoor: 1, indoor: 0.4, underground: 0 });
    expect(regionDarkness('underground', NOON_SKY)).toBe(1);
  });
});

describe('visionGate', () => {
  const levels: Level[] = [
    { id: 'L1', name: 'One' },
    { id: 'L2', name: 'Two' },
  ];
  const face = (x: number): [number, number][] => [
    [x, 0],
    [x + 4, 0],
    [x + 4, 4],
    [x, 4],
  ];
  const layer = (id: string, levelId: string, rooms: Room[] = []): DungeonLayer =>
    ({ id, type: 'dungeon', levelId, style: {}, rooms, children: [], standaloneWalls: [] }) as unknown as DungeonLayer;

  it('splits layers and tokens by level, an unknown level reading as the first', () => {
    const layers = [layer('a', 'L1'), layer('b', 'L2'), layer('c', 'nope')];
    expect(layersOnLevel({ levels }, layers, 'L1').map((l) => l.id)).toEqual(['a', 'c']);
    expect(levelIdOf({ levels }, { levelId: 'nope' })).toBe('L1');
    expect(onLevel({ levels }, {}, 'L1')).toBe(true);
    expect(onLevel({ levels }, { levelId: 'L2' }, 'L1')).toBe(false);
    expect(onLevel({ levels: [levels[0]!] }, { levelId: 'L2' }, 'L1')).toBe(true);
  });

  it('answers dark per room under the sky, live room places on top', () => {
    const map = { mapSettings: { ambientLight: WHITE, environment: 'outdoor' } as MapSettings, levels };
    const rooms = [
      { id: 'cellar', name: 'Cellar', anchor: [2, 2], face: face(0), look: { place: 'underground' } },
      { id: 'hall', name: 'Hall', anchor: [12, 2], face: face(10) },
    ] as Room[];
    const test = darkTest(map, [layer('a', 'L1', rooms)], 'L1', NOON_SKY);
    expect(test.dark(2, 2)).toBe(true);
    expect(test.dark(12, 2)).toBe(false);
    expect(test.dark(50, 50)).toBe(false);
    expect(test.darkFaces).toHaveLength(1);
    const live = darkTest(map, [layer('a', 'L1', rooms)], 'L1', NOON_SKY, { hall: { place: 'underground' } });
    expect(live.dark(12, 2)).toBe(true);
    expect(darkTest(map, [layer('a', 'L1')], 'L1', NOON_SKY).any).toBe(false);
  });
});
