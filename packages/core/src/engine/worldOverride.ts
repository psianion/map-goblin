// Which clock this engine is standing at — the one question the Editor and the Table answer
// differently, in the one place they answer it.
//
// Everything downstream of the world clock (the composed grade, the lighting pass's time
// bucket, the sun the shadow pass extrudes along) is a function of the *same* map settings and
// one number: what time it is here. The Editor has no campaign clock, so it composes one from
// the map's own — the scrub head, or a fixed map's pinned hour. The Table has the real one.
//
// A one-way override rather than a field both surfaces write: the render loop is the only
// caller of `setGrade`, and it reads whatever the surface installed. Two writers racing on one
// field is what left the Table's grade stomped back to midday every frame — a per-frame writer
// always beats an on-mutation one, whatever order they mount in.

import {
  composeGrade,
  mapClock,
  resolveWorldLight,
  type MapEnvironment,
  type NightSky,
  type SunVector,
} from '../shared/world';

/** What time it is here, and where that puts the light in the sky. */
export interface WorldFrame {
  /** Minutes 0-1439. */
  minutes: number;
  sun: SunVector;
}

/**
 * The night sky is a campaign value the Editor has no copy of, so its preview stands under the
 * same default a campaign nobody has touched plays at (`WORLD_DEFAULT`, mechanics/triggers —
 * core cannot reach it, so the value is written once here rather than imported).
 */
const EDITOR_SKY: NightSky = 'full-moon';

let installed: WorldFrame | null = null;

/**
 * State the campaign's own clock. Called from the session client; `null` hands the engine back
 * to whatever the surface composes for itself, which is what the Editor is always on.
 */
export function setTableWorld(frame: WorldFrame | null): void {
  installed = frame;
}

/** The clock this frame is drawn at: the campaign's if one was installed, else the map's own. */
export function worldFrame(map: MapEnvironment, previewClock: number | null): WorldFrame {
  if (installed) return installed;
  const minutes = mapClock(map, previewClock);
  return { minutes, sun: resolveWorldLight({ ...map, clockMinutes: minutes, nightSky: EDITOR_SKY }).sun };
}

/** The composed grade at that clock — the map's mood carrying the hour, damped by its sky. */
export const worldGrade = (
  map: MapEnvironment & { ambientLight: string },
  previewClock: number | null,
): string => composeGrade(map, worldFrame(map, previewClock).minutes);
