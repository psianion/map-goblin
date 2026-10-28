// The sky as one value: what time it is, where the sun or moon stands, what colour the hour
// paints, how dark it is and how soft shadows fall. One pure function the editor, the table,
// the export and the server all call, so the four can never disagree about the hour.
//
// `world.ts` keeps the palette and the sun maths; this file only combines them with the two
// inputs the Lighting pass added: weather (light only, no particles) and the DM's darkness
// override.

import type { Weather } from './prep';
import {
  MOON_INTENSITY,
  NEUTRAL,
  NOON,
  environmentOf,
  mixOklch,
  sunAt,
  timeColorAt,
  wrap,
  type MapEnvironment,
  type NightSky,
  type SunVector,
} from './world';

/** What weather does to light: sun strength, how far it cools the sky colour, how much darker it makes the day. */
export interface WeatherLight {
  /** Multiplies the sun/moon's casting intensity. */
  sun: number;
  /** 0..1, how far the sky colour leans toward a cool grey. */
  cool: number;
  /** 0..1, added darkness: the share of daylight the weather takes away. */
  dark: number;
  /** Shadow and light-edge softness multiplier, 1 = clear. */
  penumbra: number;
}

const WEATHER_LIGHT: Record<Weather, WeatherLight> = {
  clear: { sun: 1, cool: 0, dark: 0, penumbra: 1 },
  overcast: { sun: 0.6, cool: 0.15, dark: 0.2, penumbra: 1.8 },
  rain: { sun: 0.5, cool: 0.25, dark: 0.3, penumbra: 2 },
  storm: { sun: 0.35, cool: 0.35, dark: 0.45, penumbra: 2.5 },
  fog: { sun: 0.7, cool: 0.1, dark: 0.25, penumbra: 2.5 },
  snow: { sun: 0.8, cool: 0.05, dark: 0.1, penumbra: 1.4 },
};

/** The weather table, read for one value. An unknown weather reads as clear. */
export function weatherLight(weather: Weather | undefined): WeatherLight {
  return WEATHER_LIGHT[weather ?? 'clear'] ?? WEATHER_LIGHT.clear;
}

/** The grey a clouded sky leans toward: a touch cooler than the palette's neutral. */
const COOL_GREY = '#76808c';

export interface SkyInput extends MapEnvironment {
  /** The clock, minutes 0-1439. A `'fixed'` map ignores it and reads `fixedTime ?? NOON`. */
  minutes: number;
  /** Absent ⇒ 'full-moon'. Callers pass the live sky, else the map's default. */
  nightSky?: NightSky;
  /** Absent ⇒ 'clear'. Callers pass the live weather, else the map's default. */
  weather?: Weather;
  /** The DM's darkness override, 0..1. `null`/absent ⇒ follow the sky. */
  override?: number | null;
}

export interface SkyFrame {
  /** The minutes the frame is drawn at (a fixed map's own hour, else the clock). */
  minutes: number;
  /** Where the sun or moon stands and how hard it casts, weather included. */
  sun: SunVector;
  /** The palette colour at `minutes`, cooled by weather. A modulation around #808080. */
  skyColor: string;
  /** 0 = full sun, 1 = moonless midnight. The override when the DM set one. */
  darkness: number;
  /** 1 clear, up to 2.5 in a storm or fog: shadows and light edges soften by it. */
  penumbraScale: number;
  nightSky: NightSky;
  weather: Weather;
}

/** Where daylight ramps between: the sun's elevation (−1..1) at which it starts and is full. */
const TWILIGHT_START = -0.1;
const TWILIGHT_FULL = 0.3;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * How much natural light reaches the ground, 0..1, before weather: the sun's daylight with a
 * short twilight either side of the horizon, floored by the moon's light at night. Monotonic
 * from midnight to noon for every sky, so darkness never dips at moonset.
 */
export function daylightAt(minutes: number, nightSky: NightSky): number {
  const elevation = Math.sin((2 * Math.PI * (wrap(minutes) - 360)) / 1440);
  return Math.max(smoothstep(TWILIGHT_START, TWILIGHT_FULL, elevation), MOON_INTENSITY[nightSky]);
}

/** The minutes a map is drawn at: a fixed map's own hour (noon when unset), else the clock. */
export function skyMinutes(map: MapEnvironment, minutes: number): number {
  return wrap(map.timeMode === 'fixed' ? (map.fixedTime ?? NOON) : minutes);
}

/** The whole sky for one moment. Pure. */
export function skyFrame(input: SkyInput): SkyFrame {
  const minutes = skyMinutes(input, input.minutes);
  const nightSky = input.nightSky ?? 'full-moon';
  const weather = input.weather ?? 'clear';
  const w = weatherLight(weather);
  const base = sunAt(minutes, input, environmentOf(input), nightSky);
  const intensity = base.intensity * w.sun;
  const sun: SunVector = { ...base, intensity };
  const derived = clamp01(1 - daylightAt(minutes, nightSky) * (1 - w.dark));
  const override = input.override;
  const overridden = override !== null && override !== undefined;
  return {
    minutes,
    sun,
    // The DM's slider replaces the clock's light outright: under it the hour keeps its sun but
    // not its colour, so the slider at 0 is daylight whatever the clock says.
    skyColor: mixOklch(overridden ? NEUTRAL : timeColorAt(input.timePalette, minutes), COOL_GREY, w.cool),
    darkness: overridden ? clamp01(override) : derived,
    penumbraScale: w.penumbra,
    nightSky,
    weather,
  };
}

/**
 * What a memoized frame keys on: the colour and darkness coarsened, plus the casting sun. A
 * continuous darkness in a cache key would be no cache, so it rounds to 1/50.
 */
export function skyKey(frame: SkyFrame): string {
  return `${frame.skyColor}|${Math.round(frame.darkness * 50)}|${frame.penumbraScale}`;
}

/**
 * A frame with nothing dark in it: what the DM's "show me everything lit" view draws — no
 * darkness and the hour's colour taken out, so every region reads as at noon.
 */
export function litFrame(frame: SkyFrame): SkyFrame {
  return { ...frame, darkness: 0, skyColor: NEUTRAL };
}

/** How long a change of the DM's darkness, the weather or the night sky takes to land on screen. */
export const FADE_MS = 2000;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A frame `t` (0..1) of the way from `a` to `b`: darkness, softness and sun linear, colour through OKLCH. */
export function lerpSky(a: SkyFrame, b: SkyFrame, t: number): SkyFrame {
  if (t >= 1) return b;
  return {
    ...b,
    darkness: lerp(a.darkness, b.darkness, t),
    skyColor: mixOklch(a.skyColor, b.skyColor, t),
    penumbraScale: lerp(a.penumbraScale, b.penumbraScale, t),
    sun: { ...b.sun, intensity: lerp(a.sun.intensity, b.sun.intensity, t) },
  };
}

/**
 * Eases a shown frame toward a target sky. A change of weather, night sky or a jump in
 * darkness (the DM's slider) starts a `FADE_MS` ease from whatever is on screen; clock steps
 * are not eased (they are a game-minute each already) — they only move the target. `snap`
 * (a freeze, or a local preview while the DM drags) lands at once.
 */
export class SkyEaser {
  private from: SkyFrame | null = null;
  private to: SkyFrame | null = null;
  private shown: SkyFrame | null = null;
  private startMs = 0;

  step(target: SkyFrame, nowMs: number, snap = false): SkyFrame {
    const prev = this.to;
    if (!prev || !this.shown || snap) {
      this.from = this.to = this.shown = target;
      this.startMs = nowMs - FADE_MS;
      return target;
    }
    const jumped =
      target.weather !== prev.weather ||
      target.nightSky !== prev.nightSky ||
      Math.abs(target.darkness - prev.darkness) > 0.02;
    if (jumped) {
      this.from = this.shown;
      this.startMs = nowMs;
    }
    this.to = target;
    const t = Math.min(1, Math.max(0, (nowMs - this.startMs) / FADE_MS));
    this.shown = lerpSky(this.from!, target, t);
    return this.shown;
  }

  /** Whether an ease is still running at `nowMs`. */
  easing(nowMs: number): boolean {
    return this.to !== null && nowMs - this.startMs < FADE_MS;
  }
}
