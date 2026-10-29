import { describe, it, expect } from 'vitest';
import {
  DARK_LUMA,
  MOOD_SKY,
  SLIDER_WEIGHT,
  isDarkRegion,
  levelGrade,
  levelMood,
  regionDarkness,
  regionGrade,
  regionLight,
  roomMood,
} from './regionGrade';
import { skyFrame } from './sky';
import { darkTest, layersOnLevel, levelIdOf, onLevel, polygonEdges } from './visionGate';
import type { DungeonLayer, MapSettings } from '../store/types';
import type { Level, Room } from './types';

const NOON_SKY = skyFrame({ environment: 'outdoor', minutes: 720 });
const NIGHT_SKY = skyFrame({ environment: 'outdoor', minutes: 0, nightSky: 'moonless' });
const WHITE = '#ffffff';

describe('regionGrade: three moods × two skies', () => {
  it('a Lit region at noon is its tint, untouched', () => {
    expect(regionGrade({ mood: 'lit', moodTint: '#aabbcc' }, NOON_SKY)).toBe('#aabbcc');
  });

  it('a Dim region at noon gets 40 % of the sky: darker than Lit, lighter than Dark', () => {
    const lit = regionLight('lit', NOON_SKY);
    const dim = regionLight('dim', NOON_SKY);
    const dark = regionLight('dark', NOON_SKY);
    expect(dim).toBeLessThan(lit);
    expect(dark).toBeLessThan(dim);
  });

  it('a Dark region is near-black at noon, the tint still there', () => {
    const g = regionGrade({ mood: 'dark', moodTint: '#ff8040' }, NOON_SKY);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
    expect(r).toBeLessThan(60);
    expect(r).toBeGreaterThan(b!);
    expect(gg).toBeGreaterThan(b!);
  });

  it('a Lit region at a moonless midnight is near-black', () => {
    expect(regionLight('lit', NIGHT_SKY)).toBeLessThan(DARK_LUMA);
  });

  it('every mood is darker at night than at noon', () => {
    for (const mood of ['lit', 'dim'] as const) expect(regionLight(mood, NIGHT_SKY)).toBeLessThan(regionLight(mood, NOON_SKY));
    expect(regionLight('dark', NIGHT_SKY)).toBeLessThanOrEqual(regionLight('dark', NOON_SKY));
  });

  it('at 02:00 under a full moon Dim is darker than Lit and lighter than Dark', () => {
    const sky = skyFrame({ environment: 'outdoor', minutes: 120, nightSky: 'full-moon' });
    expect(regionLight('dim', sky)).toBeLessThan(regionLight('lit', sky));
    expect(regionLight('dark', sky)).toBeLessThan(regionLight('dim', sky));
  });

  it('Dim lies between Lit and Dark, channel by channel, at every hour under every night sky', () => {
    const channels = (g: string) => [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
    for (const nightSky of ['full-moon', 'crescent', 'moonless'] as const) {
      for (let minutes = 0; minutes < 1440; minutes += 30) {
        const sky = skyFrame({ environment: 'outdoor', minutes, nightSky });
        const [lit, dim, dark] = (['lit', 'dim', 'dark'] as const).map((mood) => channels(regionGrade({ mood, moodTint: WHITE }, sky)));
        for (let i = 0; i < 3; i++) {
          expect(dim![i]).toBeGreaterThanOrEqual(Math.min(lit![i]!, dark![i]!));
          expect(dim![i]).toBeLessThanOrEqual(Math.max(lit![i]!, dark![i]!));
        }
      }
    }
  });

  it('the slider at 1 goes near-black without erasing the tint (SLIDER_WEIGHT)', () => {
    const black = skyFrame({ environment: 'outdoor', minutes: 720, override: 1 });
    expect(regionLight('lit', black)).toBeCloseTo(1 - SLIDER_WEIGHT, 2);
    expect(regionGrade({ mood: 'lit', moodTint: WHITE }, black)).not.toBe('#000000');
  });
});

describe('isDarkRegion', () => {
  it('turns on below DARK_LUMA and only then', () => {
    expect(isDarkRegion({ mood: 'lit', moodTint: WHITE }, NOON_SKY)).toBe(false);
    expect(isDarkRegion({ mood: 'dark', moodTint: WHITE }, NOON_SKY)).toBe(true);
    expect(isDarkRegion({ mood: 'lit', moodTint: WHITE }, NIGHT_SKY)).toBe(true);
    expect(regionLight('dim', NOON_SKY)).toBeGreaterThan(DARK_LUMA);
  });

  it('ignores the tint: a dungeon-coloured map is a colour choice, not darkness', () => {
    expect(isDarkRegion({ mood: 'lit', moodTint: '#2d2d44' }, NOON_SKY)).toBe(false);
  });

  it('is off when the scope says dark is visible (moodVision)', () => {
    expect(isDarkRegion({ mood: 'dark', moodTint: WHITE, moodVision: 'visible' }, NOON_SKY)).toBe(false);
  });

  it('the slider at 1 makes every region dark, at 0.5 a Lit one stays visible', () => {
    expect(isDarkRegion({ mood: 'lit', moodTint: WHITE }, skyFrame({ minutes: 720, override: 1 }))).toBe(true);
    expect(isDarkRegion({ mood: 'lit', moodTint: WHITE }, skyFrame({ minutes: 720, override: 0.5 }))).toBe(false);
  });
});

describe('levels and the chain', () => {
  const map = { ambientLight: '#808080', environment: 'underground' } as MapSettings;

  it('a level with no look falls back to the map: its environment is its mood', () => {
    expect(levelMood(map, undefined)).toEqual({ mood: 'dark', moodTint: '#808080', moodVision: 'darkness' });
    expect(levelMood(map, { look: { mood: 'lit', moodTint: '#112233' } })).toMatchObject({ mood: 'lit', moodTint: '#112233' });
    expect(levelGrade(map, undefined, NOON_SKY)).toBe(regionGrade(levelMood(map, undefined), NOON_SKY));
  });

  it('a room resolves room ?? area ?? level ?? map', () => {
    const layer = { id: 'l', type: 'dungeon', style: {}, areas: [{ id: 'a', name: 'A', look: { mood: 'lit' } }] } as unknown as DungeonLayer;
    const room = { id: 'r', name: 'R', anchor: [0, 0], areaId: 'a' } as Room;
    expect(roomMood({ mapSettings: map, levels: [] }, layer, room).mood).toBe('lit');
    expect(roomMood({ mapSettings: map, levels: [] }, layer, { ...room, look: { mood: 'dim' } }).mood).toBe('dim');
  });

  it('memoizes: the same scope and sky answer the same string', () => {
    const a = regionGrade({ mood: 'dim', moodTint: '#445566' }, NOON_SKY);
    expect(regionGrade({ mood: 'dim', moodTint: '#445566' }, { ...NOON_SKY })).toBe(a);
    expect(MOOD_SKY).toEqual({ lit: 1, dim: 0.4, dark: 0 });
    expect(regionDarkness('dark', NOON_SKY)).toBe(1);
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

  it('answers dark per room under the sky, live room moods on top', () => {
    const map = { mapSettings: { ambientLight: WHITE, environment: 'outdoor' } as MapSettings, levels };
    const rooms = [
      { id: 'cellar', name: 'Cellar', anchor: [2, 2], face: face(0), look: { mood: 'dark' } },
      { id: 'hall', name: 'Hall', anchor: [12, 2], face: face(10) },
    ] as Room[];
    const test = darkTest(map, [layer('a', 'L1', rooms)], 'L1', NOON_SKY);
    expect(test.dark(2, 2)).toBe(true);
    expect(test.dark(12, 2)).toBe(false);
    expect(test.dark(50, 50)).toBe(false);
    expect(test.darkFaces).toHaveLength(1);
    const live = darkTest(map, [layer('a', 'L1', rooms)], 'L1', NOON_SKY, { hall: { mood: 'dark' } });
    expect(live.dark(12, 2)).toBe(true);
    expect(darkTest(map, [layer('a', 'L1')], 'L1', NOON_SKY).any).toBe(false);
  });

  it('turns a polygon into sight-only edges', () => {
    expect(polygonEdges(face(0))).toHaveLength(4);
    expect(polygonEdges(face(0))[0]).toMatchObject({ blocksLight: false, blocksSight: true });
  });
});
