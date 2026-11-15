import { describe, expect, it } from 'vitest';

import {
  BANDS,
  DAY_MINUTES,
  TIME_RAMP,
  environmentOf,
  mixOklch,
  sunAt,
  timeBucket,
  timeColorAt,
  timeOfDayAt,
  type MapEnvironment,
  type NightSky,
} from './world';

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

  it('buckets the clock so an idle table re-signs nothing', () => {
    expect(timeBucket(0)).toBe(0);
    expect(timeBucket(4)).toBe(0);
    expect(timeBucket(5)).toBe(1);
    expect(timeBucket(DAY_MINUTES)).toBe(0);
  });
});

describe('time colour', () => {
  it('lands exactly on a keyframe at its own minute', () => {
    expect(timeColorAt(720)).toBe(TIME_RAMP.noon);
    expect(timeColorAt(0)).toBe(TIME_RAMP.night);
  });

  it('moves continuously across a band boundary — no step where the vocabulary changes', () => {
    const before = timeColorAt(BANDS.day - 1);
    const after = timeColorAt(BANDS.day + 1);
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

  it('reads a map that never authored an environment as indoor', () => {
    expect(environmentOf({})).toBe('indoor');
  });
});

describe('sun and moon', () => {
  const outdoor: MapEnvironment = { environment: 'outdoor', naturalLight: true };
  const at = (minutes: number, map: MapEnvironment = outdoor, sky: NightSky = 'full-moon') =>
    sunAt(minutes, map, environmentOf(map), sky);

  it('rises east, sets west, and stands highest at midday', () => {
    expect(at(360)).toMatchObject({ azimuth: 0, kind: 'sun' });
    expect(at(720).altitude).toBeGreaterThan(at(480).altitude);
    expect(at(1079).azimuth).toBeGreaterThan(179);
  });

  it('turns the whole arc with the map orientation', () => {
    expect(at(360, { ...outdoor, orientation: 90 }).azimuth).toBe(90);
  });

  it('hands the night to the moon, weaker, and to nothing at all when there is none', () => {
    const full = at(0, outdoor, 'full-moon');
    const crescent = at(0, outdoor, 'crescent');
    expect(full.kind).toBe('moon');
    expect(full.intensity).toBeGreaterThan(crescent.intensity);
    expect(crescent.intensity).toBeGreaterThan(0);
    expect(at(0, outdoor, 'moonless')).toMatchObject({ kind: null, intensity: 0 });
  });

  it('casts nothing indoors, or with natural light off', () => {
    expect(at(720, { environment: 'indoor', naturalLight: true }).kind).toBeNull();
    expect(at(720, { environment: 'outdoor' }).kind).toBeNull();
  });

  it('crosses both horizons continuously — nothing pops where the sky changes hands', () => {
    for (const boundary of [360, 1080]) {
      const before = at(boundary - 1);
      const after = at(boundary + 1);
      expect(Math.abs(after.altitude - before.altitude)).toBeLessThan(1);
      expect(Math.abs(after.intensity - before.intensity)).toBeLessThan(0.02);
      // The azimuth hands over east↔west at the horizon, which is what a moon rising as the
      // sun sets does — and it is invisible, because both sides are casting at ~0.
      expect(before.intensity).toBeLessThan(0.02);
      expect(after.intensity).toBeLessThan(0.02);
    }
  });
});
