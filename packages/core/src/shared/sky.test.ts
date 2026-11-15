import { describe, it, expect, afterEach } from 'vitest';
import { FADE_MS, SkyEaser, cliffSunAt, daylightAt, lerpSky, litFrame, skyFrame, skyKey, weatherLight } from './sky';
import { casterLook, shadowLook } from './shadows';
import { NOON, type MapEnvironment } from './world';
import { WEATHERS } from './prep';
import { animationTime, clearFreeze, freezeOf, isFrozen } from './freeze';

const OUTDOOR: MapEnvironment = { environment: 'outdoor', naturalLight: true };

describe('skyFrame: the sun and the moon', () => {
  it('stands the sun at noon at full strength on an outdoor map that casts', () => {
    const f = skyFrame({ ...OUTDOOR, time: 'day' });
    expect(f.sun.kind).toBe('sun');
    expect(f.sun.intensity).toBeCloseTo(1);
  });

  it('hands over to the full moon at night', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'night' }).sun.kind).toBe('moon');
  });

  it('casts nothing indoors, as the resolver has always said', () => {
    expect(skyFrame({ environment: 'indoor', naturalLight: true, time: 'day' }).sun.kind).toBeNull();
  });
});

describe('skyFrame: the four times of day', () => {
  it('gives each time its sun kind', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'dawn' }).sun.kind).toBe('sun');
    expect(skyFrame({ ...OUTDOOR, time: 'day' }).sun.kind).toBe('sun');
    expect(skyFrame({ ...OUTDOOR, time: 'dusk' }).sun.kind).toBe('sun');
    expect(skyFrame({ ...OUTDOOR, time: 'night' }).sun.kind).toBe('moon');
  });

  it('keeps the sun above 0.1 at dawn and dusk, so its shadows are drawn', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'dawn' }).sun.intensity).toBeGreaterThan(0.1);
    expect(skyFrame({ ...OUTDOOR, time: 'dusk' }).sun.intensity).toBeGreaterThan(0.1);
  });

  it('is 0 dark at day, 0.25 to 0.4 at dawn and dusk, and 0.65 at night', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'day' }).darkness).toBe(0);
    for (const time of ['dawn', 'dusk'] as const) {
      const d = skyFrame({ ...OUTDOOR, time }).darkness;
      expect(d).toBeGreaterThanOrEqual(0.25);
      expect(d).toBeLessThanOrEqual(0.4);
    }
    expect(skyFrame({ ...OUTDOOR, time: 'night' }).darkness).toBeCloseTo(0.65);
  });

  it('orders the times by light: day, then dawn and dusk, then night', () => {
    const dark = (time: 'dawn' | 'day' | 'dusk' | 'night') => skyFrame({ ...OUTDOOR, time }).darkness;
    expect(dark('day')).toBeLessThan(dark('dawn'));
    expect(dark('day')).toBeLessThan(dark('dusk'));
    expect(dark('dawn')).toBeLessThan(dark('night'));
    expect(dark('dusk')).toBeLessThan(dark('night'));
  });
});

describe('the weather table', () => {
  it('has a row for every weather, clear being no change', () => {
    for (const w of WEATHERS) expect(weatherLight(w)).toBeDefined();
    expect(weatherLight('clear')).toEqual({ sun: 1, cool: 0, dark: 0, penumbra: 1 });
  });

  it('leaves the sky colour neutral at noon under the pinned clear sky', () => {
    const clear = skyFrame({ ...OUTDOOR, time: 'day' });
    expect(clear.skyColor).toBe('#808080');
    expect(clear.penumbraScale).toBe(1);
    expect(clear.weather).toBe('clear');
  });

  it('reads an unknown weather as clear rather than throwing', () => {
    expect(weatherLight('hail' as never)).toEqual(weatherLight('clear'));
  });
});

describe('skyFrame: darkness', () => {
  it('is 0 at full sun', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'day' }).darkness).toBe(0);
  });

  it('a full moon holds midnight off pitch black', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'night' }).darkness).toBeCloseTo(0.65);
  });

  it('falls monotonically from midnight to noon, for every sky', () => {
    for (const nightSky of ['full-moon', 'crescent', 'moonless'] as const) {
      let prev = Infinity;
      for (let m = 0; m <= NOON; m += 15) {
        const d = 1 - daylightAt(m, nightSky);
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        prev = d;
      }
    }
  });

  it('is the same function of the time indoors (the region place decides how much reaches in)', () => {
    expect(daylightAt(NOON, 'moonless')).toBe(1);
    expect(skyFrame({ environment: 'underground', time: 'day' }).darkness).toBe(0);
  });

  it('takes the DM override whatever the time says, and null follows the sky', () => {
    expect(skyFrame({ ...OUTDOOR, time: 'day', override: 0.8 }).darkness).toBe(0.8);
    expect(skyFrame({ ...OUTDOOR, time: 'night', override: 0 }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, time: 'day', override: null }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, time: 'day', override: 3 }).darkness).toBe(1);
  });
});

describe('skyKey, litFrame and the ease', () => {
  it('keys coarsely: a hair of darkness does not move it, a real change does', () => {
    const f = skyFrame({ ...OUTDOOR, time: 'day' });
    expect(skyKey({ ...f, darkness: 0.001 })).toBe(skyKey(f));
    expect(skyKey({ ...f, darkness: 0.5 })).not.toBe(skyKey(f));
  });

  it('litFrame takes the darkness and the hour colour out, keeping the rest', () => {
    const night = skyFrame({ ...OUTDOOR, time: 'night' });
    expect(litFrame(night)).toEqual({ ...night, darkness: 0, skyColor: '#808080' });
  });

  it('lerps darkness linearly and lands on the target', () => {
    const a = skyFrame({ ...OUTDOOR, time: 'day', override: 0 });
    const b = skyFrame({ ...OUTDOOR, time: 'day', override: 1 });
    expect(lerpSky(a, b, 0.5).darkness).toBeCloseTo(0.5);
    expect(lerpSky(a, b, 1)).toBe(b);
  });

  it('eases a slider jump over FADE_MS (2 s ± 100 ms) and holds the target after', () => {
    const easer = new SkyEaser();
    const day = skyFrame({ ...OUTDOOR, time: 'day', override: 0 });
    const black = skyFrame({ ...OUTDOOR, time: 'day', override: 1 });
    expect(easer.step(day, 0).darkness).toBe(0);
    expect(easer.step(black, 1000).darkness).toBe(0);
    expect(easer.step(black, 1500).darkness).toBeCloseTo(0.25);
    expect(easer.step(black, 1000 + FADE_MS - 100).darkness).toBeLessThan(1);
    expect(easer.step(black, 1000 + FADE_MS).darkness).toBe(1);
    expect(easer.easing(1000 + FADE_MS + 100)).toBe(false);
    expect(FADE_MS).toBe(2000);
  });

  it('snaps when asked (freeze, slider drag)', () => {
    const easer = new SkyEaser();
    easer.step(skyFrame({ ...OUTDOOR, time: 'day' }), 0);
    const black = skyFrame({ ...OUTDOOR, time: 'day', override: 1 });
    expect(easer.step(black, 20, true).darkness).toBe(1);
  });
});

describe('freeze mode', () => {
  afterEach(() => {
    clearFreeze();
    delete (globalThis as { location?: unknown }).location;
  });

  it('is off unless a test or the URL turns it on', () => {
    expect(freezeOf()).toBeNull();
    expect(isFrozen()).toBe(false);
    expect(animationTime(5000)).toBe(5);
  });

  it('reads ?freeze=<minutes> once, wrapped to the day, and pins the animation clock', () => {
    (globalThis as { location?: unknown }).location = { search: '?freeze=1500' };
    expect(freezeOf()).toEqual({ minutes: 60 });
    expect(isFrozen()).toBe(true);
    expect(animationTime(5000)).toBe(0);
  });

  it('takes a freeze set directly on the window', () => {
    (globalThis as { __GG_FREEZE__?: unknown }).__GG_FREEZE__ = { minutes: 120 };
    expect(freezeOf()).toEqual({ minutes: 120 });
  });
});

describe('cliffSunAt: cliffs cast outdoors by default', () => {
  const OPEN: MapEnvironment = { environment: 'outdoor' };
  // A day frame moved to `hour`: cliffs cast at any minute, while the sky only stands at four.
  const at = (map: MapEnvironment, hour: number) => {
    const frame = { ...skyFrame({ ...map, time: 'day' }), minutes: hour * 60 };
    return cliffSunAt(frame, map);
  };

  it('casts under an outdoor sky with natural shadows left unset, not indoors or switched off', () => {
    expect(skyFrame({ ...OPEN, time: 'day' }).sun.kind).toBeNull();
    expect(at(OPEN, 12).kind).toBe('sun');
    expect(at(OPEN, 12).intensity).toBeCloseTo(1);
    expect(at({ environment: 'indoor' }, 12).kind).toBeNull();
    expect(at({ environment: 'outdoor', naturalLight: false }, 12).kind).toBeNull();
    // With natural shadows on it is simply the sky's own sun.
    expect(at({ environment: 'outdoor', naturalLight: true }, 12)).toEqual(skyFrame({ environment: 'outdoor', naturalLight: true, time: 'day' }).sun);
  });

  it('throws a shadow as long as the drop: twice the drop, twice the reach, past a wall’s from two cells', () => {
    const look = shadowLook(at(OPEN, 16))!;
    const one = casterLook(look, 1).length;
    expect(casterLook(look, 2).length).toBeCloseTo(2 * one, 9);
    expect(casterLook(look, 3).length).toBeCloseTo(3 * one, 9);
    expect(casterLook(look, 2).length).toBeGreaterThan(look.length);
  });

  it('swings with the hour: west in the morning, east late in the day, turning all the while', () => {
    const angle = (hour: number) => {
      const l = shadowLook(at(OPEN, hour))!;
      return Math.atan2(l.dy, l.dx);
    };
    const dx = (hour: number) => shadowLook(at(OPEN, hour))!.dx;
    expect(dx(9)).toBeLessThan(-0.5);
    expect(dx(17)).toBeGreaterThan(0.5);
    const unwrap = (a: number) => (a < 0 ? a + 2 * Math.PI : a);
    const hours = [8, 10, 12, 14, 16];
    const turns = hours.map((h) => unwrap(angle(h)));
    for (let i = 1; i < turns.length; i++) expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    // Longer at the ends of the day than at noon.
    expect(shadowLook(at(OPEN, 8))!.length).toBeGreaterThan(shadowLook(at(OPEN, 12))!.length);
  });
});
