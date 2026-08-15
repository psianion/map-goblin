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
/** The sky over the campaign at night — the DM's, shared by every scene. */
export const NIGHT_SKIES = ['full-moon', 'crescent', 'moonless'] as const;
/** How fast the world clock advances on its own — real time, or the fast dial (P4). */
export const TIME_SPEEDS = ['paused', 'real', 'fast'] as const;
/** Whether a map follows the world clock or pins its own time (decision #9). */
export const TIME_MODES = ['clock', 'fixed'] as const;
/** The five colours a time palette authors, in day order from midnight's neighbour out. */
export const TIME_KEYS = ['dawn', 'morning', 'noon', 'evening', 'night'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];
export type NightSky = (typeof NIGHT_SKIES)[number];
export type TimeSpeed = (typeof TIME_SPEEDS)[number];
export type TimeMode = (typeof TIME_MODES)[number];
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

/** `real` tracks the table one-for-one; `fast` runs a whole day in about an hour. Named so
 *  the server's ticker (P4) and its tests never hardcode the multiplier twice. */
export const REAL_TIME_RATE = 1;
export const FAST_TIME_RATE = 24;
/** Game-minutes per real minute, by dial. `paused` is 0 — the ticker's short-circuit. */
export const TIME_SPEED_RATES: Record<TimeSpeed, number> = {
  paused: 0,
  real: REAL_TIME_RATE,
  fast: FAST_TIME_RATE,
};

// ─── Time palette ─────────────────────────────────────────

/**
 * A map's colour of the day: a curated biome preset, plus whatever keyframes the DM recoloured.
 * `preset` is a key of `TIME_PALETTES`; an unknown one falls back to the default rather than
 * throwing, because a palette from a newer build is not a reason to refuse to draw a map.
 */
export interface TimePalette {
  preset: string;
  keyframes?: Partial<Record<TimeKey, string>>;
}

/**
 * The curated biomes. Every value is a *modulation* colour around mid-grey (`NEUTRAL`), not a
 * literal sky: `composeGrade` multiplies it into the map's mood tint at double strength, so
 * `#808080` is "change nothing", darker dims, and the hue is the tint the hour carries.
 *
 * Noon sits at (or beside) neutral on purpose — the mood tint *is* "this world in neutral
 * daylight" (the plan's own words), so a map at midday composes to the colour its DM authored
 * and every other hour is a departure from it. Nothing here brightens a mood past what was
 * authored; a map that wants a brighter midday is a map with a brighter mood.
 *
 * Painterly starting values — tuned at the gate walk, per the plan.
 *
 * The `night` keys carry a hard constraint the daylight keys do not, and it is arithmetic
 * rather than taste. The lighting pass fills its FBO with the composed grade and *adds* each
 * light on top (`LightingRenderer`), so the grade is what decides how much headroom a torch
 * has left to burn into. A light contributes at most `255*(1-W_LIGHT_GRADE) + W_LIGHT_GRADE*g`
 * per channel, so a grade channel above ~66 makes a full-strength pool clamp at 255 — and a
 * clamped pool multiplies by white, which is no pool at all: the ground under it renders at
 * its authored daylight brightness with the warmth and the world's mood both gone.
 *
 * These keys used to be read against near-black moods, where any night key looked like night
 * and nothing could clamp. Against a neutral-daylight mood (which is what a mood now *is*)
 * a key near #3d4664 composes midnight to roughly half of noon — not a night, and no headroom.
 * Scaled to keep each biome's hue exactly and land the composed grade inside that budget.
 */
export const TIME_PALETTES: Record<string, Record<TimeKey, string>> = {
  temperate: {
    dawn: '#8a7266',
    morning: '#85817a',
    noon: '#808080',
    evening: '#8a6a5c',
    night: '#181c28',
  },
  desert: {
    dawn: '#a37c5e',
    morning: '#93856c',
    noon: '#8a8074',
    evening: '#a05f45',
    night: '#1c1e2b',
  },
  snow: {
    dawn: '#7f8698',
    morning: '#7e848e',
    noon: '#7e8490',
    evening: '#7d8496',
    night: '#171c29',
  },
  swamp: {
    dawn: '#77806e',
    morning: '#7b8172',
    noon: '#7c8274',
    evening: '#6e6b52',
    night: '#14181a',
  },
};

/** The preset a map that never picked one is painted with. */
export const DEFAULT_PALETTE = 'temperate';

/** Multiplying by this changes nothing (see `TIME_PALETTES`). */
const NEUTRAL = '#808080';

/** The palette's five colours, preset plus recolours, with an unknown preset falling back. */
export function paletteOf(palette?: TimePalette): Record<TimeKey, string> {
  const base = TIME_PALETTES[palette?.preset ?? DEFAULT_PALETTE] ?? TIME_PALETTES[DEFAULT_PALETTE]!;
  return { ...base, ...palette?.keyframes };
}

// ─── The map's authored half ──────────────────────────────

/**
 * Everything about the world a map authors for itself (zero-setup: every field optional, and
 * a map saved before any of this existed reads as an indoor map on the default palette).
 */
export interface MapEnvironment {
  /** Absent ⇒ `'indoor'`: a map that never said reads as one the sky cannot surprise. */
  environment?: Environment;
  timePalette?: TimePalette;
  /** Sun/moon direction pass (P3). Off unless the DM asked for it. */
  naturalLight?: boolean;
  /** Degrees; 0 = east at screen-right. Which way the sun comes up on this map. */
  orientation?: number;
  /** Absent ⇒ `'clock'`: the map follows the world clock. */
  timeMode?: TimeMode;
  /** Minutes 0-1439, used only in `'fixed'` mode — the DM placed the sun once. */
  fixedTime?: number;
}

/** The one reading of the optional field — see `MapEnvironment.environment`. */
export const environmentOf = (map: MapEnvironment): Environment => map.environment ?? 'indoor';

/** Midday: what a surface with no clock of its own shows, and where a new clock starts. */
export const NOON = 720;

/**
 * What time a map is drawn at where there is no campaign clock — the Editor.
 *
 * The scrub head wins when the DM is holding it; otherwise a fixed map shows the time it was
 * pinned at and every other map shows midday, which is the hour that changes a mood least.
 */
export const mapClock = (map: MapEnvironment, preview: number | null): number =>
  preview ?? (map.timeMode === 'fixed' ? (map.fixedTime ?? NOON) : NOON);

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

/** What a tick advances the clock to, and what it cost — see {@link advanceClock}. */
export interface ClockAdvance {
  /** The new clock reading, wrapped 0-1439. */
  clock: number;
  /** Wall-clock ms this advance actually spent. Consume exactly this from the ticker's base
   *  rather than jumping it to "now" — a leftover fraction of a game-minute is never lost
   *  (drift-free accumulation, P4). */
  consumedMs: number;
}

/**
 * How far `clock` moves for `elapsedMs` of wall time at `speed`, in whole game-minutes only
 * — there is no fractional minute to broadcast. `null` when nothing is due yet: paused, or
 * not even one game-minute has elapsed.
 */
export function advanceClock(clock: number, speed: TimeSpeed, elapsedMs: number): ClockAdvance | null {
  const rate = TIME_SPEED_RATES[speed];
  if (rate <= 0 || elapsedMs <= 0) return null;
  const minutes = Math.floor((elapsedMs * rate) / 60_000);
  if (minutes < 1) return null;
  return { clock: wrap(clock + minutes), consumedMs: (minutes * 60_000) / rate };
}

/**
 * Where each palette keyframe sits on the clock — the centre of the band it paints, so the
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

/** The keyframe a clock reading is leaving, and how far it has left (0..1). Continuous. */
export function timeKeyAt(minutes: number): { key: TimeKey; frac: number } {
  const { key, frac } = segmentAt(minutes);
  return { key, frac };
}

// ─── Colour ───────────────────────────────────────────────

/**
 * The palette's colour at a clock reading, interpolated in OKLCH between the two keyframes
 * either side of it.
 *
 * OKLCH rather than sRGB because the keys are hues as much as brightnesses: a straight channel
 * lerp from a warm evening to a cool night passes through a dead grey, where a hue arc walks
 * the colour round. Shortest arc, so a red-to-blue pair never takes the long way through green.
 */
export function timeColorAt(palette: TimePalette | undefined, minutes: number): string {
  const keys = paletteOf(palette);
  const { key, next, frac } = segmentAt(minutes);
  return mixOklch(keys[key], keys[next], frac);
}

/**
 * The clock, coarsened — what a memoized frame is actually keyed on (`lightingSignature`).
 *
 * A continuous clock in a cache key is no cache at all: bucketing is what lets a scrubbing DM
 * pay for a redraw a few times a second instead of sixty, and a paused clock pay nothing.
 */
export const BUCKET_MINUTES = 5;
export const timeBucket = (minutes: number): number => Math.floor(wrap(minutes) / BUCKET_MINUTES);

/**
 * The one colour the lighting pass is handed: the map's mood tint, carrying the hour, damped
 * by how much sky the map has.
 *
 * A double multiply against the palette's neutral (`TIME_PALETTES`) — so the anchor is exact:
 * an underground map (damping 0) composes to its mood byte for byte, and a neutral hour leaves
 * a mood alone at any damping.
 */
export function composeGrade(map: MapEnvironment & { ambientLight: string }, minutes: number): string {
  const damping = DAMPING[environmentOf(map)];
  const time = mixSrgb(NEUTRAL, timeColorAt(map.timePalette, minutes), damping);
  const [mr, mg, mb] = rgb(map.ambientLight);
  const [tr, tg, tb] = rgb(time);
  // Over 128 rather than 255/2 so the neutral anchor is *exact*: a mid-grey hour returns the
  // mood byte for byte, at any channel value, with no rounding drift to explain away.
  const ch = (m: number, t: number): number => clamp255((m * t) / 128);
  return hex([ch(mr, tr), ch(mg, tg), ch(mb, tb)]);
}

/** How much of the hour's colour a map takes — the plan's grade column, as a number. */
export const DAMPING: Record<Environment, number> = {
  outdoor: 1,
  /** The night outside makes the tavern moodier; the hearth still rules. */
  indoor: 0.4,
  /** A torchlit crypt at noon — the clock is not in the room at all. */
  underground: 0,
};

// ─── The resolver ─────────────────────────────────────────

/** Where the light in the sky is standing, painterly rather than astronomical. */
export interface SunVector {
  /** Degrees, `orientation`-relative: 0 is east at screen-right, 180 west. */
  azimuth: number;
  /** Degrees above the horizon, 0 at rise/set. */
  altitude: number;
  /** 0..1 — how hard it casts. 0 at the horizon, and 0 whenever `kind` is null. */
  intensity: number;
  /** null ⇒ nothing is casting: an indoor map, a map with natural light off, a moonless night. */
  kind: 'sun' | 'moon' | null;
}

export interface WorldLightInput extends MapEnvironment {
  /** The campaign clock, minutes 0-1439. Ignored by a `'fixed'` map. */
  clockMinutes: number;
  nightSky: NightSky;
  /** The DM's per-scene gate override (today's `env.ambient`). Always beats the clock. */
  override?: AmbientLevel | null;
}

export interface WorldLight {
  /** The clock this answer was resolved at — the campaign's, or a fixed map's own time. */
  minutes: number;
  /** The narration word for that reading (`env.time`'s vocabulary, off the one clock). */
  timeOfDay: TimeOfDay;
  /** The palette keyframe it is leaving, and how far (0..1) — the ribbon's playhead. */
  timeKey: TimeKey;
  timeFrac: number;
  /** How much of the hour's colour this map takes, 0..1 (`DAMPING`). */
  gradeDamping: number;
  /** The vision gate, post-override: the level `needsLight` reasoning runs on. */
  effectiveLevel: AmbientLevel;
  /**
   * How hard the composite bites, as a level — null being "nobody has stated one", which is an
   * indoor or underground map the DM has not touched. Null and `daylight` are not the same
   * scene (D2), so the migration keeps them apart here too.
   */
  biteLevel: BiteLevel | null;
  sun: SunVector;
  /** What decided `effectiveLevel` — the badge's provenance. */
  source: 'clock' | 'override' | 'fixed' | 'manual';
  /** What the clock would have said, when an override is what is being shown instead. */
  wouldBe: AmbientLevel | null;
}

/** Painterly sun arc: rise and set, and the moon taking the other half of the ring. */
const SUN_RISE = 360;
const SUN_SET = 1080;
const ARC_MINUTES = SUN_SET - SUN_RISE;
/**
 * How high the light ever climbs, in degrees. Short of 90 on purpose: a sun straight overhead
 * casts no shadow at all, and the style guide asks for one confident direction all day.
 */
const MAX_ALTITUDE = 75;
/** How hard each sky's moon casts, against the sun's 1. */
const MOON_INTENSITY: Record<NightSky, number> = { 'full-moon': 0.35, crescent: 0.15, moonless: 0 };

/**
 * The whole coupling table, as one function (plan § "Coupling table").
 *
 * Read it as three questions in order: *when* is it (a fixed map answers with its own time),
 * *what does that mean here* (outdoor follows the clock and the sky, indoor and underground
 * never auto-flip), and *did the DM say otherwise* (an override always wins, and the badge is
 * told it was an override so it can show what the clock would have said).
 */
export function resolveWorldLight(input: WorldLightInput): WorldLight {
  const fixed = input.timeMode === 'fixed';
  const minutes = wrap(fixed ? (input.fixedTime ?? 0) : input.clockMinutes);
  const environment = environmentOf(input);
  const timeOfDay = timeOfDayAt(minutes);
  const { key, frac } = timeKeyAt(minutes);
  const outdoor = environment === 'outdoor';

  // What the sky says, for an outdoor map — and what the badge reports as `wouldBe` even when
  // an override is covering it.
  const clockLevel: AmbientLevel | null = outdoor ? levelAt(timeOfDay, input.nightSky) : null;
  const clockBite: BiteLevel | null = outdoor
    ? timeOfDay === 'night' && input.nightSky === 'crescent'
      ? 'darkness-soft'
      : clockLevel
    : null;

  const override = input.override ?? null;
  const effectiveLevel = override ?? clockLevel ?? 'daylight';
  const source: WorldLight['source'] = override
    ? 'override'
    : outdoor
      ? fixed
        ? 'fixed'
        : 'clock'
      : 'manual';

  return {
    minutes,
    timeOfDay,
    timeKey: key,
    timeFrac: frac,
    gradeDamping: DAMPING[environment],
    effectiveLevel,
    biteLevel: override ?? clockBite,
    sun: sunAt(minutes, input, environment, input.nightSky),
    source,
    wouldBe: override ? clockLevel : null,
  };
}

/** The outdoor rows of the table: day is daylight, the shoulders are dusk, night is the sky's. */
function levelAt(timeOfDay: TimeOfDay, sky: NightSky): AmbientLevel {
  if (timeOfDay === 'day') return 'daylight';
  if (timeOfDay !== 'night') return 'dusk';
  return sky === 'full-moon' ? 'dusk' : 'darkness';
}

/**
 * Where the sun (or the moon, on the other half of the ring) is standing.
 *
 * Continuous through both horizons: `kind` only ever flips where the altitude and the
 * intensity are already 0, so nothing on screen can pop at a band edge.
 */
function sunAt(
  minutes: number,
  map: MapEnvironment,
  environment: Environment,
  sky: NightSky,
): SunVector {
  const day = minutes >= SUN_RISE && minutes < SUN_SET;
  const progress = day
    ? (minutes - SUN_RISE) / ARC_MINUTES
    : wrap(minutes - SUN_SET) / ARC_MINUTES;
  const arc = Math.sin(Math.PI * progress);
  const casts = environment === 'outdoor' && map.naturalLight === true;
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
function rgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex = (c: [number, number, number]): string =>
  '#' + c.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

/** Plain channel blend — used only where the endpoints are the same hue family (damping). */
function mixSrgb(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return hex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

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
