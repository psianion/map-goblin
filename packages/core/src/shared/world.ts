// The world's light, as one rule every runtime runs: what time it is, what colour that time
// paints the map, whether the party needs a torch for it, and where the sun or moon is
// standing while it happens.
//
// Pure, like `mechanics/fog/light.ts` and for the same reason — the referee (session server),
// the table (session client) and the editor (canvas) all answer these questions, and three
// implementations that happen to agree are three implementations that will stop agreeing.
// It lives in *core* rather than in mechanics only because the editor cannot reach mechanics
// (`canvas` depends on `@dnd/core` alone); mechanics re-exports it from `triggers` so the
// server and the table keep importing their rules from one place.
//
// Nothing here reads state. The map's authored half arrives as `MapEnvironment`, the
// campaign's live half as clock/sky/override arguments, and the answer is a value.

import type { AmbientLevel, TimeOfDay } from './prep';

// ─── Vocabulary ───────────────────────────────────────────

/** How a map relates to the sky (authored). Absent ⇒ `'indoor'` — see `environmentOf`. */
export const ENVIRONMENTS = ['outdoor', 'indoor', 'underground'] as const;
/** The sky at night. Pinned to a full moon for now; the moon's light maths stays for its return. */
export const NIGHT_SKIES = ['full-moon', 'crescent', 'moonless'] as const;
/** The five colours of the day's ramp, in day order from midnight's neighbour out. */
export const TIME_KEYS = ['dawn', 'morning', 'noon', 'evening', 'night'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];
export type NightSky = (typeof NIGHT_SKIES)[number];
export type TimeKey = (typeof TIME_KEYS)[number];

/**
 * The gate's three levels plus the one the *sky* adds: a crescent moon is a `darkness` scene
 * for every mechanical purpose (`effectiveLevel` still says darkness, so vision still clips to
 * the torches) that reads a shade softer than a moonless one, because there is a little light
 * out there. Presentation only — nothing mechanical may switch on it.
 */
export type BiteLevel = AmbientLevel | 'darkness-soft';

/** Minutes in a day — the clock's modulus, and the one place the number is written. */
export const DAY_MINUTES = 1440;

// ─── The day's colour ─────────────────────────────────────

/**
 * The day's colour ramp. Every value is a *modulation* colour around mid-grey (`NEUTRAL`), not
 * a literal sky: the region grade multiplies it into the map's tint at double strength, so
 * `#808080` is "change nothing", darker dims, and the hue is the tint the hour carries.
 *
 * Noon sits at neutral on purpose: the tint *is* "this world in neutral daylight", so a map at
 * midday draws in the colour its DM authored and every other hour is a departure from it.
 *
 * The `night` key carries a hard constraint the daylight keys do not, and it is arithmetic
 * rather than taste. The lighting pass fills its FBO with the grade and *adds* each light on
 * top (`LightingRenderer`), so the grade is what decides how much headroom a torch has left to
 * burn into. A light contributes at most `255*(1-W_LIGHT_GRADE) + W_LIGHT_GRADE*g` per channel,
 * so a grade channel above ~66 makes a full-strength pool clamp at 255, and a clamped pool
 * multiplies by white, which is no pool at all.
 */
export const TIME_RAMP: Record<TimeKey, string> = {
  dawn: '#8a7266',
  morning: '#85817a',
  noon: '#808080',
  evening: '#8a6a5c',
  night: '#181c28',
};

/** Multiplying by this changes nothing (see `TIME_RAMP`). */
export const NEUTRAL = '#808080';

// ─── The map's authored half ──────────────────────────────

/**
 * Everything about the world a map authors for itself (zero-setup: every field optional, and
 * a map saved before any of this existed reads as an indoor map).
 */
export interface MapEnvironment {
  /** Absent ⇒ `'indoor'`: a map that never said reads as one the sky cannot surprise. */
  environment?: Environment;
  /** Sun/moon direction pass (P3). Off unless the DM asked for it. */
  naturalLight?: boolean;
  /** Degrees; 0 = east at screen-right. Which way the sun comes up on this map. */
  orientation?: number;
}

/** The one reading of the optional field — see `MapEnvironment.environment`. */
export const environmentOf = (map: MapEnvironment): Environment => map.environment ?? 'indoor';

/** Midday: where an old clock with no reading starts. */
export const NOON = 720;

/**
 * The minute each time of day is drawn at. 06:35 and 17:25 put the sun just above the horizon,
 * so Dawn and Dusk read part dark with long shadows; exactly 06:00 would be as dark as night
 * with no sun at all.
 */
export const TIME_MINUTES: Record<TimeOfDay, number> = { dawn: 395, day: 720, dusk: 1045, night: 0 };

// ─── Bands ────────────────────────────────────────────────

/**
 * Where the day's four narration bands start, in minutes. Fixed rather than seasonal: the
 * table wants a word for the hour, not an almanac. Nothing continuous is allowed to *step* at
 * these — they name the gate and the vocabulary, while colour and sun position are functions
 * of the clock itself (`timeColorAt`, `sunAt`).
 */
export const BANDS = { dawn: 300, day: 420, dusk: 1020, night: 1140 } as const;

/** The narration word for a clock reading — `env.time`'s vocabulary, off the one clock. */
export function timeOfDayAt(minutes: number): TimeOfDay {
  const m = wrap(minutes);
  if (m < BANDS.dawn || m >= BANDS.night) return 'night';
  if (m < BANDS.day) return 'dawn';
  if (m < BANDS.dusk) return 'day';
  return 'dusk';
}

/**
 * Where each ramp keyframe sits on the clock — the centre of the band it paints, so the
 * interpolation between two keys spends itself across the band boundary instead of on it.
 */
export const KEY_MINUTES: Record<TimeKey, number> = {
  night: 0,
  dawn: 360,
  morning: 540,
  noon: 720,
  evening: 1080,
};

/** The same anchors in clock order, wrapping midnight — night ends the ring as well as starts it. */
const RING: [TimeKey, number][] = [
  ...TIME_KEYS.map((key): [TimeKey, number] => [key, KEY_MINUTES[key]]).sort((a, b) => a[1] - b[1]),
  ['night', DAY_MINUTES],
];

/** The keyframe a clock reading is leaving, the one it is heading for, and how far (0..1). */
function segmentAt(minutes: number): { key: TimeKey; next: TimeKey; frac: number } {
  const m = wrap(minutes);
  for (let i = 0; i < RING.length - 1; i++) {
    const [key, at] = RING[i]!;
    const [next, until] = RING[i + 1]!;
    if (m < until) return { key, next, frac: (m - at) / (until - at) };
  }
  return { key: 'night', next: 'night', frac: 0 };
}

// ─── Colour ───────────────────────────────────────────────

/**
 * The ramp's colour at a clock reading, interpolated in OKLCH between the two keyframes either
 * side of it.
 *
 * OKLCH rather than sRGB because the keys are hues as much as brightnesses: a straight channel
 * lerp from a warm evening to a cool night passes through a dead grey, where a hue arc walks
 * the colour round. Shortest arc, so a red-to-blue pair never takes the long way through green.
 */
export function timeColorAt(minutes: number): string {
  const { key, next, frac } = segmentAt(minutes);
  return mixOklch(TIME_RAMP[key], TIME_RAMP[next], frac);
}

/**
 * The clock, coarsened — what a memoized frame is actually keyed on (`lightingSignature`).
 *
 * A continuous clock in a cache key is no cache at all: bucketing is what lets a scrubbing DM
 * pay for a redraw a few times a second instead of sixty, and a paused clock pay nothing.
 */
export const BUCKET_MINUTES = 5;
export const timeBucket = (minutes: number): number => Math.floor(wrap(minutes) / BUCKET_MINUTES);

// ─── The sun ──────────────────────────────────────────────

/** Where the light in the sky is standing, painterly rather than astronomical. */
export interface SunVector {
  /** Degrees, `orientation`-relative: 0 is east at screen-right, 180 west. */
  azimuth: number;
  /** Degrees above the horizon, 0 at rise/set. */
  altitude: number;
  /** 0..1 — how hard it casts. 0 at the horizon, and 0 whenever `kind` is null. */
  intensity: number;
  /** null ⇒ nothing is casting: a map with natural light off, a moonless night. */
  kind: 'sun' | 'moon' | null;
}

/** Painterly sun arc: rise and set, and the moon taking the other half of the ring. */
export const SUN_RISE = 360;
const SUN_SET = 1080;
const ARC_MINUTES = SUN_SET - SUN_RISE;
/**
 * How high the light ever climbs, in degrees. Short of 90 on purpose: a sun straight overhead
 * casts no shadow at all, and the style guide asks for one confident direction all day.
 */
const MAX_ALTITUDE = 75;
/** How hard each sky's moon casts, against the sun's 1. */
export const MOON_INTENSITY: Record<NightSky, number> = { 'full-moon': 0.35, crescent: 0.15, moonless: 0 };

/**
 * Where the sun (or the moon, on the other half of the ring) is standing.
 *
 * Continuous through both horizons: `kind` only ever flips where the altitude and the
 * intensity are already 0, so nothing on screen can pop at a band edge.
 */
export function sunAt(minutes: number, map: MapEnvironment, sky: NightSky): SunVector {
  const day = minutes >= SUN_RISE && minutes < SUN_SET;
  const progress = day
    ? (minutes - SUN_RISE) / ARC_MINUTES
    : wrap(minutes - SUN_SET) / ARC_MINUTES;
  const arc = Math.sin(Math.PI * progress);
  // Whatever the map's place: which ground the light reaches is the shadow pass's question,
  // asked region by region.
  const casts = map.naturalLight === true;
  const strength = day ? 1 : MOON_INTENSITY[sky];
  return {
    azimuth: wrapDegrees((map.orientation ?? 0) + progress * 180),
    altitude: arc * MAX_ALTITUDE,
    intensity: casts ? arc * strength : 0,
    kind: casts && strength > 0 ? (day ? 'sun' : 'moon') : null,
  };
}

// ─── Colour maths ─────────────────────────────────────────

export const wrap = (m: number): number => ((m % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
const wrapDegrees = (d: number): number => ((d % 360) + 360) % 360;
const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** '#rrggbb' → [r, g, b]. Anything unparseable reads as mid-grey rather than as black. */
export function rgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hex = (c: [number, number, number]): string =>
  '#' + c.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

/** sRGB → Oklab (Björn Ottosson's matrices). */
function oklab(color: string): [number, number, number] {
  const [r, g, b] = rgb(color).map(srgbToLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(L: number, A: number, B: number): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return hex([
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** Interpolate two colours through OKLCH — lightness, chroma, and the shortest hue arc. */
export function mixOklch(a: string, b: string, t: number): string {
  if (t <= 0) return normalize(a);
  if (t >= 1) return normalize(b);
  const [aL, aA, aB] = oklab(a);
  const [bL, bA, bB] = oklab(b);
  const aC = Math.hypot(aA, aB);
  const bC = Math.hypot(bA, bB);
  const aH = Math.atan2(aB, aA);
  const bH = Math.atan2(bB, bA);
  // Shortest arc; a colour with no chroma has no meaningful hue, so it borrows the other's.
  const from = aC < 1e-6 ? bH : aH;
  const to = bC < 1e-6 ? aH : bH;
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const L = aL + (bL - aL) * t;
  const C = aC + (bC - aC) * t;
  const H = from + delta * t;
  return fromOklab(L, Math.cos(H) * C, Math.sin(H) * C);
}

const normalize = (color: string): string => hex(rgb(color));
