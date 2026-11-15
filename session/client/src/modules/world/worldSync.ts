// The Table's sky, handed to the engine — the one thing this surface knows that the Editor
// does not.
//
// Everything the world decides (the per-region grade, the lighting pass's sky key, the sun the
// P3 shadow pass extrudes along, night-only lights) is composed inside core's render loop from
// the map's own settings plus one `SkyFrame`. The Editor composes that frame from its preview;
// here it is the campaign's — the map's settings, the time of day and the scene's darkness
// slider (`worldSkyOf`), the same frame the referee gates sight with, so the mask and the
// picture cannot disagree.
//
// It also hands over the table's other two live lighting inputs: the room places the DM set
// for the scene (`triggers.roomEdits`) and the level this seat is looking at (`viewedLevel`),
// which the engine shows through `ui.activeLevelId`.
//
// Shaped like `syncLightsToScene`/`syncDoorsToLighting`: a subscription on both stores, slice
// identity as the whole test, and a cleanup the mounting effect returns.

import {
  displayedSky,
  setTableRoomPlaces,
  setTableWorld,
  tableWorld,
} from '@dnd/core/src/engine/worldOverride';
import { useStore } from '@dnd/core/src/store/store';
import { freezeOf } from '@dnd/core/src/shared/freeze';
import type { SkyFrame } from '@dnd/core/src/shared/sky';
import { timeOfDayAt, type Environment } from '@dnd/core/src/shared/world';
import {
  roomEditsOf,
  sceneTriggersOf,
  viewedLevel,
  worldSkyOf,
  type TriggersState,
} from '@dnd/mechanics/triggers';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';
// The Sky tab's two client-only values (the slider under the DM's thumb, "Show me
// everything lit") live in worldPrefs; this sync reads them and re-installs on any change.
import { dmLit, getDarknessPreview, subscribeWorldPrefs } from './worldPrefs';

/** The sky over the scene the table is playing, or `null` before the join snapshot lands. */
function activeSky(): SkyFrame | null {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return null;
  const freeze = freezeOf();
  const darknessPreview = getDarknessPreview();
  let patched = triggers;
  if (freeze) patched = { ...patched, world: { time: timeOfDayAt(freeze.minutes) } };
  if (darknessPreview !== null) {
    const scene = sceneTriggersOf(patched, sceneId);
    patched = { ...patched, byScene: { ...patched.byScene, [sceneId]: { ...scene, darkness: darknessPreview } } };
  }
  return worldSkyOf(patched, useStore.getState().mapSettings, sceneId);
}

/** The table's live room places for the scene, by room id. */
function activeRoomPlaces(): Record<string, Environment> | null {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return null;
  const places: Record<string, Environment> = {};
  for (const [roomId, edit] of Object.entries(roomEditsOf(sceneTriggersOf(triggers, sceneId)))) {
    if (edit.place) places[roomId] = edit.place;
  }
  return places;
}

/** The level this seat is looking at, or null when the map has one level (or none yet). */
function activeLevel(): string | null {
  const { session, you } = useSessionStore.getState();
  const sceneId = session?.activeSceneId;
  const levels = useStore.getState().levels ?? [];
  if (!sceneId || !you || levels.length <= 1) return null;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  const tokens = Object.values((session?.modules?.tokens as TokensState | undefined)?.byScene?.[sceneId] ?? {});
  const scene = sceneTriggersOf(triggers ?? { byScene: {} }, sceneId);
  return viewedLevel(scene, tokens, you, levels[0]!.id);
}

/**
 * Keep the engine standing under the campaign's own sky, on this seat's level. Call from an
 * effect; the returned function is the effect's cleanup, and it hands the sky back.
 */
export function syncWorldToScene(): () => void {
  // Read-only e2e handle: the sky the engine is drawing this tick (eased), else the one installed.
  (globalThis as { __ggSky?: () => SkyFrame | null }).__ggSky = () => displayedSky() ?? tableWorld();
  let last: unknown[] = [];
  const check = (force = false): void => {
    const { session, you } = useSessionStore.getState();
    const core = useStore.getState();
    const next = [
      session?.modules?.triggers,
      session?.modules?.tokens,
      session?.activeSceneId,
      you,
      core.mapSettings,
      core.levels,
    ];
    if (!force && next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    setTableWorld(activeSky(), {
      snap: getDarknessPreview() !== null,
      allLit: dmLit() && you?.role === 'dm',
    });
    setTableRoomPlaces(activeRoomPlaces());
    const level = activeLevel();
    if (level && core.ui.activeLevelId !== level) core.setActiveLevelId(level);
  };
  check();
  const unsubPrefs = subscribeWorldPrefs(() => check(true));
  const unsubSession = useSessionStore.subscribe(() => check());
  const unsubMap = useStore.subscribe(() => check());
  return () => {
    unsubPrefs();
    unsubSession();
    unsubMap();
    setTableWorld(null);
    setTableRoomPlaces(null);
  };
}
