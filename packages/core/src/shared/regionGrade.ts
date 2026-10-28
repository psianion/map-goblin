// What colour the ground of one region is drawn under, and whether it is dark enough to hide
// from sight. A region is a room, an area or a level, read through the look chain
// (`lookScope.ts`): its `mood` says how much sky light reaches it (Lit 100 %, Dim 40 %, Dark
// 0 %, the same steps as the map's environment), its `moodTint` is its colour, and
// `moodVision` says whether dark means darkness for player sight.
//
// One number feeds the vision gate: the light reaching the region (`regionLight`). Mood,
// night, weather and the DM's slider all move it, so there is one rule, not four.

import type { DungeonLayer, MapSettings } from '../store/types';
import type { Level, Mood, Room } from './types';
import type { SkyFrame } from './sky';
import { skyKey } from './sky';
import { ENVIRONMENT_MOOD, resolveLookKey, roomChain } from './lookScope';
import { NEUTRAL, environmentOf, hex, rgb } from './world';

/** How much sky light reaches a region, by mood. */
export const MOOD_SKY: Record<Mood, number> = { lit: 1, dim: 0.4, dark: 0 };

/** How far darkness 1 takes a grade toward black: near-black, with the tint still there. */
export const SLIDER_WEIGHT = 0.85;

/** Below this light (0..1 luma), a region counts as darkness for player sight. */
export const DARK_LUMA = 0.22;

/** The three look keys a region's light reads, resolved. */
export interface RegionMood {
  mood: Mood;
  moodTint: string;
  moodVision?: 'darkness' | 'visible';
}

/** The darkness a region sees: the sky's, raised by how little of the sky reaches it. */
export function regionDarkness(mood: Mood, sky: Pick<SkyFrame, 'darkness'>): number {
  return 1 - (1 - sky.darkness) * MOOD_SKY[mood];
}

/**
 * What a region multiplies its tint by, per channel, over 128: the Dark region's (neutral,
 * dimmed by darkness 1) and the Lit region's (the hour's colour, dimmed by the sky's darkness),
 * mixed by the share of sky that reaches it. Mixing the two results, not the colour and the
 * darkness apart, keeps Dim between Lit and Dark at every hour: a night sky's colour is itself
 * darker than neutral, so taking less of it and less of its light made Dim brighter than Lit.
 */
function modulation(mood: Mood, sky: SkyFrame): [number, number, number] {
  const share = MOOD_SKY[mood];
  const litK = 1 - regionDarkness('lit', sky) * SLIDER_WEIGHT;
  const darkK = 1 - regionDarkness('dark', sky) * SLIDER_WEIGHT;
  const lit = rgb(sky.skyColor);
  const dark = rgb(NEUTRAL);
  const ch = (i: number): number => (1 - share) * dark[i]! * darkK + share * lit[i]! * litK;
  return [ch(0), ch(1), ch(2)];
}

const memo = new Map<string, string>();

/**
 * The colour the composite multiplies a region by: the region's tint carrying the hour,
 * dimmed by the darkness, by the share of sky its mood lets in (`modulation`).
 * Memoized per (mood, tint, sky key).
 */
export function regionGrade(scope: RegionMood, sky: SkyFrame): string {
  const key = `${scope.mood}|${scope.moodTint}|${skyKey(sky)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const mod = modulation(scope.mood, sky);
  const [mr, mg, mb] = rgb(scope.moodTint);
  const ch = (m: number, t: number): number => (m * t) / 128;
  const out = hex([ch(mr, mod[0]), ch(mg, mod[1]), ch(mb, mod[2])]);
  if (memo.size > 512) memo.clear();
  memo.set(key, out);
  return out;
}

/** Relative luminance of an sRGB triple, 0..1 (Rec. 709 weights on the encoded values). */
const luma = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * The light reaching a region, 0..1, with the tint left out: a map painted in a deep dungeon
 * colour is a colour choice, not a darkness rule. Noon under a clear sky on a Lit region is 1.
 */
export function regionLight(mood: Mood, sky: SkyFrame): number {
  const mod = modulation(mood, sky);
  return Math.min(1, luma(mod[0] * 2, mod[1] * 2, mod[2] * 2));
}

/** Whether a region hides from player sight unless lit: dark enough, and its scope says dark means darkness. */
export function isDarkRegion(scope: RegionMood, sky: SkyFrame): boolean {
  if (scope.moodVision === 'visible') return false;
  return regionLight(scope.mood, sky) < DARK_LUMA;
}

type MapLike = Pick<MapSettings, 'ambientLight' | 'environment'>;

/** A level's own mood, falling back to the map's (its environment and ambient light). */
export function levelMood(map: MapLike, level: Pick<Level, 'look'> | undefined): RegionMood {
  const look = level?.look;
  return {
    mood: look?.mood ?? ENVIRONMENT_MOOD[environmentOf(map)],
    moodTint: look?.moodTint ?? map.ambientLight,
    moodVision: look?.moodVision ?? 'darkness',
  };
}

/** The colour of ground outside any room on a level: the level's look, then the map's. */
export function levelGrade(map: MapLike, level: Pick<Level, 'look'> | undefined, sky: SkyFrame): string {
  return regionGrade(levelMood(map, level), sky);
}

/** A room's mood through the whole chain (room ?? area ?? level ?? map). */
export function roomMood(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
  room: Room,
): RegionMood {
  const chain = roomChain(state, layer, room);
  return {
    mood: resolveLookKey(chain, 'mood'),
    moodTint: resolveLookKey(chain, 'moodTint'),
    moodVision: resolveLookKey(chain, 'moodVision'),
  };
}
