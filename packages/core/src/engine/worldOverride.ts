// Which sky this engine is standing under — the one question the Editor and the Table answer
// differently, in the one place they answer it.
//
// Everything downstream of the world clock (the per-region grade, the lighting pass's sky key,
// the sun the shadow pass extrudes along, night-only lights) is a function of the *same* map
// settings and one `SkyFrame` (shared/sky.ts). The Editor has no campaign clock, so it composes
// one from the map's own — the scrub head, or a fixed map's pinned hour, plus the preview sky
// and weather. The Table installs the real one.
//
// A one-way override rather than a field both surfaces write: the render loop is the only
// caller of `setSky`, and it reads whatever the surface installed. Two writers racing on one
// field is what left the Table's grade stomped back to midday every frame — a per-frame writer
// always beats an on-mutation one, whatever order they mount in.

import { composeGrade, mapClock, type MapEnvironment, type NightSky } from '../shared/world';
import type { Weather } from '../shared/prep';
import { skyFrame, type SkyFrame } from '../shared/sky';
import { freezeOf } from '../shared/freeze';
import type { Mood } from '../shared/types';

/** What time it is here, and the whole sky that puts over the map. */
export type WorldFrame = SkyFrame;

/**
 * The night sky is a campaign value the Editor has no copy of, so its preview defaults to the
 * map's own default sky, else the sky a campaign nobody has touched plays at (`WORLD_DEFAULT`,
 * mechanics/triggers — core cannot reach it, so the value is written once here).
 */
const EDITOR_SKY: NightSky = 'full-moon';

let installed: SkyFrame | null = null;
let installedSnaps = false;
let installedAllLit = false;
let displayed: SkyFrame | null = null;
let roomMoods: Record<string, Mood> | null = null;
let roomMoodsVersion = 0;

/**
 * State the campaign's own sky. Called from the session client; `null` hands the engine back
 * to whatever the surface composes for itself, which is what the Editor is always on.
 *
 * `snap` lands the frame without the 2 s ease (the DM's local preview while dragging the
 * darkness slider); `allLit` is the DM's "show me everything lit" view, renderer-only.
 */
export function setTableWorld(frame: SkyFrame | null, opts: { snap?: boolean; allLit?: boolean } = {}): void {
  installed = frame;
  installedSnaps = opts.snap === true;
  installedAllLit = opts.allLit === true;
}

/** The installed table frame, or null in the Editor. */
export const tableWorld = (): SkyFrame | null => installed;

/** Whether the installed frame lands without easing (see `setTableWorld`). */
export const tableWorldSnaps = (): boolean => installedSnaps;

/** Whether the installed frame asks for the DM's everything-lit view. */
export const tableAllLit = (): boolean => installed !== null && installedAllLit;

/** What the render loop actually drew this tick (the eased frame) — the fog reads this. */
export function setDisplayedSky(frame: SkyFrame | null): void {
  displayed = frame;
}

export const displayedSky = (): SkyFrame | null => displayed;

/**
 * The table's live room moods (`triggers.roomEdits`), by room id, over the authored look
 * chain. `null` in the Editor.
 */
export function setTableRoomMoods(moods: Record<string, Mood> | null): void {
  const same =
    moods === roomMoods ||
    (moods !== null &&
      roomMoods !== null &&
      Object.keys(moods).length === Object.keys(roomMoods).length &&
      Object.entries(moods).every(([k, v]) => roomMoods![k] === v));
  if (same) return;
  roomMoods = moods;
  roomMoodsVersion++;
}

export const tableRoomMoods = (): Record<string, Mood> | null => roomMoods;

/** Moves whenever `setTableRoomMoods` changes anything — the render loop's region memo key. */
export const tableRoomMoodsVersion = (): number => roomMoodsVersion;

/**
 * The sky this frame is drawn under: the campaign's if one was installed, else the map's own
 * (preview clock, or a fixed map's hour, or noon; preview sky and weather, or the map's
 * defaults). Under a freeze (`?freeze=`) the Editor's clock stands at the frozen minute.
 */
export function worldFrame(
  map: MapEnvironment,
  previewClock: number | null,
  previewSky: NightSky | null = null,
  previewWeather: Weather | null = null,
): SkyFrame {
  if (installed) return installed;
  const minutes = freezeOf()?.minutes ?? mapClock(map, previewClock);
  // `minutes` is already resolved (preview, fixed hour or noon), so the frame reads it as a clock.
  return skyFrame({
    ...map,
    timeMode: 'clock',
    minutes,
    nightSky: previewSky ?? map.nightSky ?? EDITOR_SKY,
    weather: previewWeather ?? map.weather,
  });
}

/** The composed grade at that clock — the map's mood carrying the hour, damped by its sky. */
export const worldGrade = (
  map: MapEnvironment & { ambientLight: string },
  previewClock: number | null,
): string => composeGrade(map, worldFrame(map, previewClock).minutes);
