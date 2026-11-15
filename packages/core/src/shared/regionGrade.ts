// What colour the ground of one region is drawn under, and whether it is dark enough to hide
// from sight. A region is a room, an area or a level, read through the look chain
// (`lookScope.ts`): its `place` says how much sky light reaches it (Outdoor 100 %, Indoor
// 40 %, Underground 0 %), and its tint is always the map's ambient light.
//
// One number feeds the vision gate: the light reaching the region (`regionLight`). Place,
// night and the DM's slider all move it, so there is one rule, not three.

import type { DungeonLayer, MapSettings } from '../store/types';
import type { Level, Room } from './types';
import type { SkyFrame } from './sky';
import { skyKey } from './sky';
import { resolveLookKey, roomChain } from './lookScope';
import { NEUTRAL, environmentOf, hex, rgb, type Environment } from './world';

/** How much sky light reaches a region, by place. */
export const SKY_SHARE: Record<Environment, number> = { outdoor: 1, indoor: 0.4, underground: 0 };

/** How far darkness 1 takes a grade toward black: near-black, with the tint still there. */
export const SLIDER_WEIGHT = 0.85;

/** Below this light (0..1 luma), a region counts as darkness for player sight. */
export const DARK_LUMA = 0.22;

/** What a region's light reads: its place, and the tint it is drawn in. */
export interface RegionLight {
  place: Environment;
  tint: string;
}

/** The darkness a region sees: the sky's, raised by how little of the sky reaches it. */
export function regionDarkness(place: Environment, sky: Pick<SkyFrame, 'darkness'>): number {
  return 1 - (1 - sky.darkness) * SKY_SHARE[place];
}

/**
 * What a region multiplies its tint by, per channel, over 128: the Underground region's
 * (neutral, dimmed by darkness 1) and the Outdoor region's (the hour's colour, dimmed by the
 * sky's darkness), mixed by the share of sky that reaches it. Mixing the two results, not the
 * colour and the darkness apart, keeps Indoor between Outdoor and Underground at every hour: a
 * night sky's colour is itself darker than neutral, so taking less of it and less of its light
 * made Indoor brighter than Outdoor.
 */
function modulation(place: Environment, sky: SkyFrame): [number, number, number] {
  const share = SKY_SHARE[place];
  const litK = 1 - regionDarkness('outdoor', sky) * SLIDER_WEIGHT;
  const darkK = 1 - regionDarkness('underground', sky) * SLIDER_WEIGHT;
  const lit = rgb(sky.skyColor);
  const dark = rgb(NEUTRAL);
  const ch = (i: number): number => (1 - share) * dark[i]! * darkK + share * lit[i]! * litK;
  return [ch(0), ch(1), ch(2)];
}

const memo = new Map<string, string>();

/**
 * The colour the composite multiplies a region by: the region's tint carrying the hour,
 * dimmed by the darkness, by the share of sky its place lets in (`modulation`).
 * Memoized per (place, tint, sky key).
 */
export function regionGrade(region: RegionLight, sky: SkyFrame): string {
  const key = `${region.place}|${region.tint}|${skyKey(sky)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const mod = modulation(region.place, sky);
  const [mr, mg, mb] = rgb(region.tint);
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
 * colour is a colour choice, not a darkness rule. Noon under a clear sky on Outdoor ground is 1.
 */
export function regionLight(place: Environment, sky: SkyFrame): number {
  const mod = modulation(place, sky);
  return Math.min(1, luma(mod[0] * 2, mod[1] * 2, mod[2] * 2));
}

/** Whether a region hides from player sight unless lit: too little light reaches it. */
export function isDarkRegion(place: Environment, sky: SkyFrame): boolean {
  return regionLight(place, sky) < DARK_LUMA;
}

type MapLike = Pick<MapSettings, 'ambientLight' | 'environment'>;

/** A level's own place, falling back to the map's. */
export function levelPlace(map: MapLike, level: Pick<Level, 'look'> | undefined): Environment {
  return level?.look?.place ?? environmentOf(map);
}

/** The colour of ground outside any room on a level: the level's place, in the map's tint. */
export function levelGrade(map: MapLike, level: Pick<Level, 'look'> | undefined, sky: SkyFrame): string {
  return regionGrade({ place: levelPlace(map, level), tint: map.ambientLight }, sky);
}

/** A room's place through the whole chain (room ?? area ?? level ?? map). */
export function roomPlace(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
  room: Room,
): Environment {
  return resolveLookKey(roomChain(state, layer, room), 'place');
}
