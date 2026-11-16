// Which sky this engine is standing under — the one question the Editor and the Table answer
// differently, in the one place they answer it.
//
// Everything downstream of the time of day (the per-region grade, the lighting pass's sky key,
// the sun the shadow pass extrudes along, night-only lights) is a function of the *same* map
// settings and one `SkyFrame` (shared/sky.ts). The Editor has no campaign time, so it composes
// one from its preview; the Table installs the real one.
//
// A one-way override rather than a field both surfaces write: the render loop is the only
// caller of `setSky`, and it reads whatever the surface installed. Two writers racing on one
// field is what left the Table's grade stomped back to midday every frame — a per-frame writer
// always beats an on-mutation one, whatever order they mount in.

import { timeOfDayAt, type Environment, type MapEnvironment } from '../shared/world';
import type { TimeOfDay } from '../shared/prep';
import { skyFrame, type SkyFrame, type SkyInput } from '../shared/sky';
import { freezeOf } from '../shared/freeze';

/** What time it is here, and the whole sky that puts over the map. */
export type WorldFrame = SkyFrame;

let installed: SkyFrame | null = null;
let installedSnaps = false;
let installedAllLit = false;
let displayed: SkyFrame | null = null;
let roomPlaces: Record<string, Environment> | null = null;
let roomPlacesVersion = 0;

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
 * The table's live room places (`triggers.roomEdits`), by room id, over the authored look
 * chain. `null` in the Editor.
 */
export function setTableRoomPlaces(places: Record<string, Environment> | null): void {
  const same =
    places === roomPlaces ||
    (places !== null &&
      roomPlaces !== null &&
      Object.keys(places).length === Object.keys(roomPlaces).length &&
      Object.entries(places).every(([k, v]) => roomPlaces![k] === v));
  if (same) return;
  roomPlaces = places;
  roomPlacesVersion++;
}

export const tableRoomPlaces = (): Record<string, Environment> | null => roomPlaces;

/** Moves whenever `setTableRoomPlaces` changes anything — the render loop's region memo key. */
export const tableRoomPlacesVersion = (): number => roomPlacesVersion;

/**
 * The sky this frame is drawn under: the campaign's if one was installed, else the map's own
 * at the preview time (Day when none). Under a freeze (`?freeze=`) the Editor stands at the
 * time of day the frozen minute falls in. The map's own tint for that time rides on the frame.
 */
export function worldFrame(map: MapEnvironment & Pick<SkyInput, 'timeTints'>, previewTime: TimeOfDay | null = null): SkyFrame {
  if (installed) return installed;
  const frozen = freezeOf();
  return skyFrame({ ...map, time: frozen ? timeOfDayAt(frozen.minutes) : (previewTime ?? 'day') });
}
