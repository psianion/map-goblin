// What the World block *says* — everything the panel and the status bar render, derived from
// one resolver answer (`resolveWorldLight`) and nothing else.
//
// Pure and here rather than inside the panel because two surfaces read it: the block's own
// badge, which is always on screen because it is the thing a DM opens the panel for, and the
// status bar's one-line mirror, which keeps today's "omit the boring" rule. Two renderings of
// one sentence; not two sentences.

import { vocabLabel, type AmbientLevel } from '@dnd/core/src/shared/prep';
import {
  DAMPING,
  DAY_MINUTES,
  KEY_MINUTES,
  TIME_KEYS,
  composeGrade,
  environmentOf,
  mixOklch,
  timeKeyAt,
  type Environment,
  type MapEnvironment,
  type NightSky,
  type TimeKey,
  type WorldLight,
} from '@dnd/core/src/shared/world';

/** 24-hour clock, the readout a DM reads at a glance. */
export const hhmm = (minutes: number): string =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(minutes % 60)
    .toString()
    .padStart(2, '0')}`;

/**
 * The level, as three things that are not colour: a glyph whose fill *is* the amount of light,
 * the word, and (for darkness) how hard it bites.
 */
const GLYPH: Record<AmbientLevel, string> = { daylight: '○', dusk: '◐', darkness: '●' };

export const SKY_LABEL: Record<NightSky, string> = {
  'full-moon': 'Full moon',
  crescent: 'Crescent',
  moonless: 'Moonless',
};

/** What the level does to the table. Names who is affected — the DM's own view never changes. */
const CONSEQUENCE: Record<AmbientLevel, string> = {
  daylight: 'Players see the whole map.',
  dusk: 'The light thins. No sight is clipped.',
  darkness: 'Beyond torchlight, players see nothing.',
};
const SOFT_CONSEQUENCE = 'Beyond torchlight players read shapes, not detail.';
/** Nobody has set a level on a map the sky cannot reach — not the same scene as `daylight` (D2). */
const UNSET_CONSEQUENCE = 'No gate set. The scene lights as its map was authored.';

export interface WorldBadge {
  /** ○ / ◐ / ● — the amount of light, drawn. */
  glyph: string;
  level: string;
  /** 'soft' / 'full' — only darkness has two of them. */
  bite: string | null;
  /** The provenance chip: what decided the level. */
  provenance: string;
  /** An override is showing: the chip takes a lock, the trace takes a strike. */
  overridden: boolean;
  /** The coupling chain, left to right — rendered with `›` between the parts. */
  trace: string[];
  /** …and what it resolves to, after the arrow. */
  traceOut: string;
  /** The line that replaces the struck-through trace when the DM has set the gate. */
  overrideLine: string | null;
  consequence: string;
  /** The status bar's mirror — null whenever the world is doing nothing worth a word. */
  mirror: string | null;
}

/**
 * The whole badge, from one resolver answer plus the two inputs it does not carry back
 * (which map this is, and what is in the sky).
 */
export function worldBadge(light: WorldLight, map: MapEnvironment, sky: NightSky): WorldBadge {
  const environment = environmentOf(map);
  const outdoor = environment === 'outdoor';
  const night = light.timeOfDay === 'night';
  const overridden = light.source === 'override';
  const level = vocabLabel(light.effectiveLevel);
  const timeWord = vocabLabel(light.timeOfDay);
  const bite =
    light.biteLevel === 'darkness-soft' ? 'soft' : light.biteLevel === 'darkness' ? 'full' : null;

  // The clock's own answer, which is what the trace traces — an override is drawn over it,
  // never in place of it, so the DM keeps seeing what the world would have done.
  const clockLevel = overridden ? light.wouldBe : outdoor ? light.effectiveLevel : null;
  const fixed = map.timeMode === 'fixed';

  const trace = outdoor
    ? [
        'Outdoor',
        fixed ? `${timeWord} — fixed ${hhmm(light.minutes)}` : timeWord,
        night ? SKY_LABEL[sky] : 'sky n/a',
      ]
    : environment === 'indoor'
      ? ['Indoor', `${timeWord} — tint only`, 'sky n/a']
      : ['Underground', 'clock ignored', 'sky ignored'];

  return {
    glyph: GLYPH[light.effectiveLevel],
    level,
    bite: light.effectiveLevel === 'darkness' ? bite : null,
    provenance:
      light.source === 'override'
        ? 'Override · you'
        : light.source === 'fixed'
          ? `Fixed · ${hhmm(light.minutes)}`
          : light.source === 'clock'
            ? 'Auto · clock'
            : 'Manual · not set',
    overridden,
    trace,
    traceOut: clockLevel ? vocabLabel(clockLevel) : 'no auto gate',
    overrideLine: overridden
      ? light.wouldBe
        ? `You set ${level}. The clock would say ${vocabLabel(light.wouldBe)}.`
        : `You set ${level}. This map takes no auto gate.`
      : null,
    consequence:
      light.source === 'manual'
        ? UNSET_CONSEQUENCE
        : bite === 'soft'
          ? SOFT_CONSEQUENCE
          : CONSEQUENCE[light.effectiveLevel],
    mirror: mirrorOf(light, environment, sky, overridden, level, timeWord),
  };
}

/**
 * The status bar's line. Daylight on a clock nobody has touched is the state every table is
 * in until something happens, so it prints nothing — the bar carries the light only when it
 * is something the table can feel (the rule the env badge already played by).
 */
function mirrorOf(
  light: WorldLight,
  environment: Environment,
  sky: NightSky,
  overridden: boolean,
  level: string,
  timeWord: string,
): string | null {
  if (overridden) return `${level} (override)`;
  const parts: string[] = [];
  // Underground is the one map the hour says nothing about (`DAMPING`), so it goes unsaid.
  if (environment !== 'underground' && light.timeOfDay !== 'day') parts.push(timeWord);
  if (environment === 'outdoor' && light.timeOfDay === 'night') parts.push(SKY_LABEL[sky]);
  if (light.effectiveLevel !== 'daylight') parts.push(level);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─── The ribbon ───────────────────────────────────────────

/** How many colours the day's gradient is drawn from. Hourly: a picture, not a colour reference. */
const RIBBON_STOPS = 24;

/**
 * How much black each sky mixes into the night end of the ribbon. Presentation only — the
 * mechanical difference between the three is `resolveWorldLight`'s, not this.
 */
const SKY_DIM: Record<NightSky, number> = { 'full-moon': 0, crescent: 0.28, moonless: 0.55 };

/**
 * How far into the night a clock reading is, 0..1 — the weight the sky's dimming lands with.
 *
 * Off the palette's own ring (`timeKeyAt`) rather than the narration bands, so the dimming
 * fades in across the evening and out across the dawn instead of stepping at a band edge.
 */
function nightWeight(minutes: number): number {
  const { key, frac } = timeKeyAt(minutes);
  if (key === 'night') return 1 - frac;
  if (key === 'evening') return frac;
  return 0;
}

/**
 * The map's own day, as CSS: the composed grade (mood × hour × how much sky this map has,
 * `composeGrade`) sampled across the clock, with the night end carrying the sky.
 *
 * An underground map composes to its mood at every hour (damping 0), so its ribbon comes out
 * flat on its own — "time buys you nothing here" is drawn by the shared rule, not asserted by
 * a special case in here.
 */
export function ribbonGradient(
  map: MapEnvironment & { ambientLight: string },
  sky: NightSky,
): string {
  // Through the same damping the grade takes, so the sky reaches a map exactly as far as the
  // hour does: fully outdoors, a share of it indoors, and not at all under the ground.
  const dim = SKY_DIM[sky] * DAMPING[environmentOf(map)];
  const stops: string[] = [];
  for (let i = 0; i < RIBBON_STOPS; i++) {
    const minutes = (i / RIBBON_STOPS) * DAY_MINUTES;
    const grade = composeGrade(map, minutes);
    const color = dim > 0 ? mixOklch(grade, '#000000', dim * nightWeight(minutes)) : grade;
    stops.push(`${color} ${((i / (RIBBON_STOPS - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Where a minute of the day sits on the ribbon, as a percentage. */
export const ribbonAt = (minutes: number): string =>
  `${((minutes / DAY_MINUTES) * 100).toFixed(2)}%`;

// ─── Quick jumps ──────────────────────────────────────────

/** The five hours a DM jumps to, off the palette's own anchors — one list, not a second one. */
export const JUMPS: readonly { key: TimeKey; label: string; minutes: number }[] = TIME_KEYS.map(
  (key) => ({ key, label: key[0]!.toUpperCase() + key.slice(1), minutes: KEY_MINUTES[key] }),
);

/**
 * Which jump the clock is standing on — the nearest anchor around the ring, so 22:10 reads as
 * night rather than as "still leaving evening".
 */
export function nearestJump(minutes: number): TimeKey {
  let best = JUMPS[0]!;
  let bestGap = DAY_MINUTES;
  for (const jump of JUMPS) {
    const raw = Math.abs(minutes - jump.minutes);
    const gap = Math.min(raw, DAY_MINUTES - raw);
    if (gap < bestGap) {
      bestGap = gap;
      best = jump;
    }
  }
  return best.key;
}
