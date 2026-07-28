// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); their fog status comes off the session's `fog` module slice.

import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { sceneFogOf, type FogState, type RoomFog, type RoomFogStatus, type SceneFog } from '@dnd/mechanics/fog';

/** What a DM reads for each status. The word is the state; colour never carries it alone. */
export const FOG_STATUS_LABEL: Record<RoomFogStatus, string> = {
  never_revealed: 'Unrevealed',
  revealed: 'Revealed',
  re_hidden: 'Explored',
};

/** What clicking the room will do next — reveal anything dark, re-hide anything lit. */
export const fogActionFor = (status: RoomFogStatus): 'reveal' | 'hide' =>
  status === 'revealed' ? 'hide' : 'reveal';

/**
 * D11's DM grammar, restrained: unrevealed carries the heavier tint, explored a lighter
 * one plus a glyph, revealed nothing at all. Two encodings on every state that has one, so
 * "explored" survives a bad panel in a dim room.
 */
export interface FogLook {
  /** 0 = draw nothing over the room. */
  tintAlpha: number;
  /** The small "explored" mark at the centroid. */
  glyph: boolean;
}

export const DM_FOG_LOOK: Record<RoomFogStatus, FogLook> = {
  never_revealed: { tintAlpha: 0.62, glyph: false },
  revealed: { tintAlpha: 0, glyph: false },
  re_hidden: { tintAlpha: 0.32, glyph: true },
};

/** Every zoned area of the loaded map. Corridors are rooms (D6) — nothing filters them. */
export function roomsOfLayers(layers: readonly Layer[]): Room[] {
  return layers.flatMap((layer) => (layer.type === 'dungeon' ? (layer.rooms ?? []) : []));
}

/**
 * The rooms the *server* is fogging by — off the document it sent, not off core's store.
 *
 * Core re-detects rooms from wall and floor geometry after any load (`roomSync`, the
 * backfill for files saved before rooms existed) and overwrites `layer.rooms` with the
 * result. On a map nobody zoned that invents rooms the referee does not have: the server
 * reads `layer.rooms` off the file, finds none and fogs nothing, while anything built on
 * core's store tints or masks rooms no fog command can even name. Measured on
 * `demo-dungeon.mapbuilder`: 0 rooms on disk, 4 in the store.
 *
 * The redacted document is the honest source for both seats. A player's copy carries exactly
 * the rooms they are allowed to know about, which is the set their mask is a statement about;
 * the DM's is the file.
 */
export function serverRooms(mapData: unknown): Room[] {
  const layers = (mapData as { layers?: Layer[] } | null)?.layers;
  return layers ? roomsOfLayers(layers) : [];
}

/** The room polygon under a world point, or undefined for unzoned map (D6). */
export function roomAt(rooms: readonly Room[], x: number, y: number): Room | undefined {
  return rooms.find((room) => room.boundary.length >= 3 && pointInPolygon([x, y], room.boundary));
}

/** D9 Reveal All: every room in the scene, latch set. */
export function revealAllRooms(rooms: readonly Room[]): Record<string, RoomFog> {
  const next: Record<string, RoomFog> = {};
  for (const room of rooms) next[room.id] = { status: 'revealed', wasEverRevealed: true };
  return next;
}

/**
 * D9 Hide All: everything the party has seen goes back under. Rooms nobody has seen are
 * left out of the record entirely — absent *is* `never_revealed` (D1), and writing them in
 * would be the same state at more bytes.
 */
export function hideAllRooms(current: Record<string, RoomFog>): Record<string, RoomFog> {
  const next: Record<string, RoomFog> = {};
  for (const [id, fog] of Object.entries(current)) {
    if (fog.wasEverRevealed) next[id] = { status: 're_hidden', wasEverRevealed: true };
  }
  return next;
}

/**
 * The scene's fog. `sceneFogOf` already answers "untouched scene ⇒ nothing revealed,
 * concealment on"; this only adds the two states the wire has that the module never does —
 * no slice yet, and no active scene yet.
 */
export function sceneFog(state: FogState | undefined, sceneId: string | null | undefined): SceneFog {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  return scene?.rooms ? scene : sceneFogOf({ byScene: {} }, '');
}

export { roomFogOf as roomFog } from '@dnd/mechanics/fog';
