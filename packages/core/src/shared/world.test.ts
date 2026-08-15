import { describe, expect, it } from 'vitest';

import {
  BANDS,
  DAY_MINUTES,
  composeGrade,
  environmentOf,
  mixOklch,
  paletteOf,
  resolveWorldLight,
  timeBucket,
  timeColorAt,
  timeKeyAt,
  timeOfDayAt,
  type NightSky,
  type WorldLightInput,
} from './world';

/** Outdoor, clock-driven, nothing overridden — the row the coupling table starts from. */
const at = (over: Partial<WorldLightInput> = {}): ReturnType<typeof resolveWorldLight> =>
  resolveWorldLight({ environment: 'outdoor', clockMinutes: 720, nightSky: 'full-moon', ...over });

describe('time bands and keyframes', () => {
  it('names the hour the way the table narrates it', () => {
    expect(timeOfDayAt(0)).toBe('night');
    expect(timeOfDayAt(BANDS.dawn)).toBe('dawn');
    expect(timeOfDayAt(BANDS.day)).toBe('day');
    expect(timeOfDayAt(BANDS.dusk)).toBe('dusk');
    expect(timeOfDayAt(BANDS.night)).toBe('night');
    expect(timeOfDayAt(BANDS.dawn - 1)).toBe('night');
  });

  it('wraps a clock reading outside the day rather than falling off the ring', () => {
    expect(timeOfDayAt(DAY_MINUTES + 720)).toBe('day');
    expect(timeOfDayAt(-60)).toBe('night');
  });

  it('walks the keyframes in day order, each one arriving at frac 0', () => {
    expect(timeKeyAt(0)).toEqual({ key: 'night', frac: 0 });
    expect(timeKeyAt(360)).toEqual({ key: 'dawn', frac: 0 });
    expect(timeKeyAt(540)).toEqual({ key: 'morning', frac: 0 });
    expect(timeKeyAt(720)).toEqual({ key: 'noon', frac: 0 });
    expect(timeKeyAt(1080)).toEqual({ key: 'evening', frac: 0 });
    expect(timeKeyAt(1260).key).toBe('evening');
    expect(timeKeyAt(1260).frac).toBeCloseTo(0.5, 5);
  });

  it('buckets the clock so an idle table re-signs nothing', () => {
    expect(timeBucket(0)).toBe(0);
    expect(timeBucket(4)).toBe(0);
    expect(timeBucket(5)).toBe(1);
    expect(timeBucket(DAY_MINUTES)).toBe(0);
  });
});

describe('time colour', () => {
  it('lands exactly on a keyframe at its own minute', () => {
    const palette = { preset: 'temperate' };
    expect(timeColorAt(palette, 720)).toBe(paletteOf(palette).noon);
    expect(timeColorAt(palette, 0)).toBe(paletteOf(palette).night);
  });

  it('takes a recoloured keyframe over the preset, and an unknown preset falls back', () => {
    const palette = { preset: 'nope', keyframes: { noon: '#ff0000' } };
    expect(timeColorAt(palette, 720)).toBe('#ff0000');
    expect(paletteOf(palette).night).toBe(paletteOf({ preset: 'temperate' }).night);
  });

  it('moves continuously across a band boundary — no step where the vocabulary changes', () => {
    const palette = { preset: 'temperate' };
    const before = timeColorAt(palette, BANDS.day - 1);
    const after = timeColorAt(palette, BANDS.day + 1);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(parseInt(before.slice(1 + i * 2, 3 + i * 2), 16) - parseInt(after.slice(1 + i * 2, 3 + i * 2), 16))).toBeLessThan(4);
    }
  });

  it('interpolates through OKLCH rather than through grey', () => {
    // Halfway from warm to cool, a channel lerp desaturates; the hue arc keeps chroma up.
    const mid = mixOklch('#c08040', '#4080c0', 0.5);
    const [r, , b] = [0, 1, 2].map((i) => parseInt(mid.slice(1 + i * 2, 3 + i * 2), 16));
    expect(Math.abs(r! - b!)).toBeLessThan(48);
    expect(mixOklch('#c08040', '#4080c0', 0)).toBe('#c08040');
    expect(mixOklch('#c08040', '#4080c0', 1)).toBe('#4080c0');
  });
});

describe('grade composition', () => {
  const mood = '#2d2d44';

  it('leaves an underground map at its mood, byte for byte, at every hour', () => {
    for (const minutes of [0, 360, 720, 1080]) {
      expect(composeGrade({ ambientLight: mood, environment: 'underground' }, minutes)).toBe(mood);
    }
  });

  it('damps an indoor map between the mood and what an outdoor one would take', () => {
    const night = 0;
    const indoor = composeGrade({ ambientLight: mood, environment: 'indoor' }, night);
    const outdoor = composeGrade({ ambientLight: mood, environment: 'outdoor' }, night);
    const lum = (c: string): number =>
      [0, 1, 2].reduce((s, i) => s + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16), 0);
    expect(lum(outdoor)).toBeLessThan(lum(indoor));
    expect(lum(indoor)).toBeLessThan(lum(mood));
  });

  it('darkens outdoor night against outdoor noon', () => {
    const lum = (c: string): number =>
      [0, 1, 2].reduce((s, i) => s + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16), 0);
    const map = { ambientLight: mood, environment: 'outdoor' as const };
    expect(lum(composeGrade(map, 0))).toBeLessThan(lum(composeGrade(map, 720)));
  });

  it('leaves an outdoor map at midday on its authored mood — the grade’s anchor', () => {
    // "The mood tint is this world in neutral daylight": a map at noon is the colour its DM
    // picked, which is also what keeps every map drawn before the clock existed unchanged.
    expect(composeGrade({ ambientLight: mood, environment: 'outdoor' }, 720)).toBe(mood);
  });

  it('reads a map that never authored an environment as indoor', () => {
    expect(environmentOf({})).toBe('indoor');
    expect(composeGrade({ ambientLight: mood }, 0)).toBe(
      composeGrade({ ambientLight: mood, environment: 'indoor' }, 0),
    );
  });
});

describe('the coupling table', () => {
  const rows: [string, number, NightSky, string, string | null][] = [
    // clock, sky → effective gate, bite level
    ['day', 720, 'full-moon', 'daylight', 'daylight'],
    ['dawn', 360, 'full-moon', 'dusk', 'dusk'],
    ['dusk', 1080, 'full-moon', 'dusk', 'dusk'],
    ['night under a full moon', 0, 'full-moon', 'dusk', 'dusk'],
    ['night under a crescent', 0, 'crescent', 'darkness', 'darkness-soft'],
    ['a moonless night', 0, 'moonless', 'darkness', 'darkness'],
  ];

  it.each(rows)('outdoor at %s gates on %s', (_name, clockMinutes, nightSky, level, bite) => {
    const light = at({ clockMinutes, nightSky });
    expect(light.effectiveLevel).toBe(level);
    expect(light.biteLevel).toBe(bite);
    expect(light.source).toBe('clock');
    expect(light.gradeDamping).toBe(1);
  });

  it.each(['indoor', 'underground'] as const)('%s never auto-flips, at any hour or sky', (environment) => {
    for (const clockMinutes of [0, 360, 720, 1080]) {
      for (const nightSky of ['full-moon', 'crescent', 'moonless'] as const) {
        const light = at({ environment, clockMinutes, nightSky });
        expect(light.effectiveLevel).toBe('daylight');
        // Null, not `daylight`: an untouched scene composites exactly as it did before the
        // clock existed (D2's absent-is-not-daylight rule, carried through the migration).
        expect(light.biteLevel).toBeNull();
        expect(light.source).toBe('manual');
        expect(light.wouldBe).toBeNull();
      }
    }
    expect(at({ environment }).gradeDamping).toBe(environment === 'indoor' ? 0.4 : 0);
  });

  it('lets the DM override beat the clock, and reports what the clock would have said', () => {
    const light = at({ clockMinutes: 720, override: 'darkness' });
    expect(light.effectiveLevel).toBe('darkness');
    expect(light.biteLevel).toBe('darkness');
    expect(light.source).toBe('override');
    expect(light.wouldBe).toBe('daylight');
  });

  it('an override on an indoor map is the whole answer, with nothing to contradict it', () => {
    const light = at({ environment: 'indoor', override: 'darkness' });
    expect(light.effectiveLevel).toBe('darkness');
    expect(light.source).toBe('override');
    expect(light.wouldBe).toBeNull();
  });

  it('pins a fixed map to its own time and ignores the world clock', () => {
    const light = at({ timeMode: 'fixed', fixedTime: 0, clockMinutes: 720, nightSky: 'moonless' });
    expect(light.minutes).toBe(0);
    expect(light.timeOfDay).toBe('night');
    expect(light.effectiveLevel).toBe('darkness');
    expect(light.source).toBe('fixed');
    // …and the clock moving under it changes nothing at all.
    expect(
      at({ timeMode: 'fixed', fixedTime: 0, clockMinutes: 300, nightSky: 'moonless' }),
    ).toEqual(light);
  });
});

describe('sun and moon', () => {
  const outdoor = { environment: 'outdoor' as const, naturalLight: true };

  it('rises east, sets west, and stands highest at midday', () => {
    expect(at({ ...outdoor, clockMinutes: 360 }).sun).toMatchObject({ azimuth: 0, kind: 'sun' });
    expect(at({ ...outdoor, clockMinutes: 720 }).sun.altitude).toBeGreaterThan(
      at({ ...outdoor, clockMinutes: 480 }).sun.altitude,
    );
    expect(at({ ...outdoor, clockMinutes: 1079 }).sun.azimuth).toBeGreaterThan(179);
  });

  it('turns the whole arc with the map orientation', () => {
    expect(at({ ...outdoor, orientation: 90, clockMinutes: 360 }).sun.azimuth).toBe(90);
  });

  it('hands the night to the moon, weaker, and to nothing at all when there is none', () => {
    const full = at({ ...outdoor, clockMinutes: 0, nightSky: 'full-moon' }).sun;
    const crescent = at({ ...outdoor, clockMinutes: 0, nightSky: 'crescent' }).sun;
    expect(full.kind).toBe('moon');
    expect(full.intensity).toBeGreaterThan(crescent.intensity);
    expect(crescent.intensity).toBeGreaterThan(0);
    expect(at({ ...outdoor, clockMinutes: 0, nightSky: 'moonless' }).sun).toMatchObject({
      kind: null,
      intensity: 0,
    });
  });

  it('casts nothing indoors, or with natural light off', () => {
    expect(at({ environment: 'indoor', naturalLight: true, clockMinutes: 720 }).sun.kind).toBeNull();
    expect(at({ environment: 'outdoor', clockMinutes: 720 }).sun.kind).toBeNull();
  });

  it('crosses both horizons continuously — nothing pops where the sky changes hands', () => {
    for (const boundary of [360, 1080]) {
      const before = at({ ...outdoor, clockMinutes: boundary - 1 }).sun;
      const after = at({ ...outdoor, clockMinutes: boundary + 1 }).sun;
      expect(Math.abs(after.altitude - before.altitude)).toBeLessThan(1);
      expect(Math.abs(after.intensity - before.intensity)).toBeLessThan(0.02);
      // The azimuth hands over east↔west at the horizon, which is what a moon rising as the
      // sun sets does — and it is invisible, because both sides are casting at ~0.
      expect(before.intensity).toBeLessThan(0.02);
      expect(after.intensity).toBeLessThan(0.02);
    }
  });

  it('never steps the grade input at a band boundary either', () => {
    for (const boundary of Object.values(BANDS)) {
      const before = at({ ...outdoor, clockMinutes: boundary - 1 });
      const after = at({ ...outdoor, clockMinutes: boundary + 1 });
      const lum = (c: string): number =>
        [0, 1, 2].reduce((s, i) => s + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16), 0);
      const grade = (m: number): string => composeGrade({ ambientLight: '#2d2d44', ...outdoor }, m);
      expect(Math.abs(lum(grade(before.minutes)) - lum(grade(after.minutes)))).toBeLessThan(8);
    }
  });
});
