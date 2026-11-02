import { describe, it, expect, afterEach } from 'vitest';
import { FADE_MS, SkyEaser, cliffSunAt, daylightAt, lerpSky, litFrame, skyFrame, skyKey, skyMinutes, weatherLight } from './sky';
import { casterLook, shadowLook } from './shadows';
import { NOON, resolveWorldLight, mapClock, type MapEnvironment } from './world';
import { WEATHERS } from './prep';
import { animationTime, clearFreeze, freezeOf, isFrozen } from './freeze';

const OUTDOOR: MapEnvironment = { environment: 'outdoor', naturalLight: true };

describe('skyFrame: the sun and the moon', () => {
  it('stands the sun at noon at full strength on an outdoor map that casts', () => {
    const f = skyFrame({ ...OUTDOOR, minutes: NOON });
    expect(f.sun.kind).toBe('sun');
    expect(f.sun.intensity).toBeCloseTo(1);
  });

  it('hands over to the moon at night, at its sky’s strength', () => {
    const full = skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'full-moon' });
    const crescent = skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'crescent' });
    expect(full.sun.kind).toBe('moon');
    expect(crescent.sun.intensity).toBeLessThan(full.sun.intensity);
    expect(skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'moonless' }).sun.kind).toBeNull();
  });

  it('casts nothing indoors, as the resolver has always said', () => {
    expect(skyFrame({ environment: 'indoor', naturalLight: true, minutes: NOON }).sun.kind).toBeNull();
  });

  it('matches the world resolver’s sun under a clear sky', () => {
    const f = skyFrame({ ...OUTDOOR, minutes: 900, nightSky: 'crescent' });
    expect(f.sun).toEqual(resolveWorldLight({ ...OUTDOOR, clockMinutes: 900, nightSky: 'crescent' }).sun);
  });
});

describe('skyFrame: the weather table', () => {
  it('has a row for every weather, clear being no change', () => {
    for (const w of WEATHERS) expect(weatherLight(w)).toBeDefined();
    expect(weatherLight('clear')).toEqual({ sun: 1, cool: 0, dark: 0, penumbra: 1 });
  });

  it('dims the sun by the weather', () => {
    const clear = skyFrame({ ...OUTDOOR, minutes: NOON });
    const storm = skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'storm' });
    expect(storm.sun.intensity).toBeCloseTo(clear.sun.intensity * 0.35);
  });

  it('raises the darkness of a day by the weather', () => {
    expect(skyFrame({ ...OUTDOOR, minutes: NOON }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'overcast' }).darkness).toBeCloseTo(0.2);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'storm' }).darkness).toBeCloseTo(0.45);
  });

  it('softens shadows: clear 1, storm and fog 2.5', () => {
    expect(skyFrame({ ...OUTDOOR, minutes: NOON }).penumbraScale).toBe(1);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'storm' }).penumbraScale).toBe(2.5);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'fog' }).penumbraScale).toBe(2.5);
  });

  it('cools the sky colour, and leaves it alone when clear', () => {
    const clear = skyFrame({ ...OUTDOOR, minutes: NOON });
    expect(clear.skyColor).toBe('#808080');
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, weather: 'rain' }).skyColor).not.toBe(clear.skyColor);
  });

  it('reads an unknown weather as clear rather than throwing', () => {
    expect(weatherLight('hail' as never)).toEqual(weatherLight('clear'));
  });
});

describe('skyFrame: darkness', () => {
  it('is 0 at full sun and 1 at a moonless midnight', () => {
    expect(skyFrame({ ...OUTDOOR, minutes: NOON }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'moonless' }).darkness).toBe(1);
  });

  it('a full moon holds midnight off pitch black', () => {
    expect(skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'full-moon' }).darkness).toBeCloseTo(0.65);
  });

  it('falls monotonically from midnight to noon, for every sky', () => {
    for (const nightSky of ['full-moon', 'crescent', 'moonless'] as const) {
      let prev = Infinity;
      for (let m = 0; m <= NOON; m += 15) {
        const d = skyFrame({ ...OUTDOOR, minutes: m, nightSky }).darkness;
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        prev = d;
      }
    }
  });

  it('is the same function of the clock indoors (the region mood decides how much reaches in)', () => {
    expect(daylightAt(NOON, 'moonless')).toBe(1);
    expect(skyFrame({ environment: 'underground', minutes: NOON }).darkness).toBe(0);
  });

  it('takes the DM override whatever the clock says, and null follows the sky', () => {
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, override: 0.8 }).darkness).toBe(0.8);
    expect(skyFrame({ ...OUTDOOR, minutes: 0, nightSky: 'moonless', override: 0 }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, override: null }).darkness).toBe(0);
    expect(skyFrame({ ...OUTDOOR, minutes: NOON, override: 3 }).darkness).toBe(1);
  });
});

describe('skyFrame: one fixed-time default (agreed gap)', () => {
  it('reads an unset fixed hour as noon, like mapClock and the resolver', () => {
    const fixed: MapEnvironment = { ...OUTDOOR, timeMode: 'fixed' };
    expect(skyFrame({ ...fixed, minutes: 0 }).minutes).toBe(NOON);
    expect(skyMinutes(fixed, 0)).toBe(NOON);
    expect(mapClock(fixed, null)).toBe(NOON);
    expect(resolveWorldLight({ ...fixed, clockMinutes: 0, nightSky: 'full-moon' }).minutes).toBe(NOON);
  });

  it('a fixed map ignores the clock; a clock map follows it', () => {
    expect(skyFrame({ ...OUTDOOR, timeMode: 'fixed', fixedTime: 300, minutes: 900 }).minutes).toBe(300);
    expect(skyFrame({ ...OUTDOOR, minutes: 900 }).minutes).toBe(900);
  });
});

describe('skyKey, litFrame and the ease', () => {
  it('keys coarsely: a hair of darkness does not move it, a real change does', () => {
    const f = skyFrame({ ...OUTDOOR, minutes: NOON });
    expect(skyKey({ ...f, darkness: 0.001 })).toBe(skyKey(f));
    expect(skyKey({ ...f, darkness: 0.5 })).not.toBe(skyKey(f));
  });

  it('litFrame takes the darkness and the hour colour out, keeping the rest', () => {
    const night = skyFrame({ ...OUTDOOR, minutes: 0 });
    expect(litFrame(night)).toEqual({ ...night, darkness: 0, skyColor: '#808080' });
  });

  it('lerps darkness linearly and lands on the target', () => {
    const a = skyFrame({ ...OUTDOOR, minutes: NOON, override: 0 });
    const b = skyFrame({ ...OUTDOOR, minutes: NOON, override: 1 });
    expect(lerpSky(a, b, 0.5).darkness).toBeCloseTo(0.5);
    expect(lerpSky(a, b, 1)).toBe(b);
  });

  it('eases a slider jump over FADE_MS (2 s ± 100 ms) and holds the target after', () => {
    const easer = new SkyEaser();
    const day = skyFrame({ ...OUTDOOR, minutes: NOON, override: 0 });
    const black = skyFrame({ ...OUTDOOR, minutes: NOON, override: 1 });
    expect(easer.step(day, 0).darkness).toBe(0);
    expect(easer.step(black, 1000).darkness).toBe(0);
    expect(easer.step(black, 1500).darkness).toBeCloseTo(0.25);
    expect(easer.step(black, 1000 + FADE_MS - 100).darkness).toBeLessThan(1);
    expect(easer.step(black, 1000 + FADE_MS).darkness).toBe(1);
    expect(easer.easing(1000 + FADE_MS + 100)).toBe(false);
    expect(FADE_MS).toBe(2000);
  });

  it('does not ease a clock step, and snaps when asked (freeze, slider drag)', () => {
    const easer = new SkyEaser();
    easer.step(skyFrame({ ...OUTDOOR, minutes: 600 }), 0);
    expect(easer.step(skyFrame({ ...OUTDOOR, minutes: 601 }), 10).minutes).toBe(601);
    const black = skyFrame({ ...OUTDOOR, minutes: 601, override: 1 });
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
  const at = (map: MapEnvironment, hour: number) => {
    const frame = skyFrame({ ...map, minutes: hour * 60 });
    return cliffSunAt(frame, map);
  };

  it('casts under an outdoor sky with natural shadows left unset, not indoors or switched off', () => {
    expect(skyFrame({ ...OPEN, minutes: NOON }).sun.kind).toBeNull();
    expect(at(OPEN, 12).kind).toBe('sun');
    expect(at(OPEN, 12).intensity).toBeCloseTo(1);
    expect(at({ environment: 'indoor' }, 12).kind).toBeNull();
    expect(at({ environment: 'outdoor', naturalLight: false }, 12).kind).toBeNull();
    // With natural shadows on it is simply the sky's own sun.
    expect(at({ environment: 'outdoor', naturalLight: true }, 15)).toEqual(skyFrame({ environment: 'outdoor', naturalLight: true, minutes: 900 }).sun);
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
