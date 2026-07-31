// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); their fog status comes off the session's `fog` module slice.

import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import { sceneFogOf, type FogState, type RoomFog, type RoomFogStatus, type SceneFog } from '@dnd/mechanics/fog';
import { liveDoors, type LiveDoor } from '../doors/doors';

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
 * D11's DM grammar, restrained: unrevealed carries the heaviest tint, explored a lighter
 * one, revealed nothing at all. Three weights of one near-black, so the state reads as
 * brightness rather than as hue and survives a bad panel in a dim room.
 *
 * No mark is stamped on the room to second that. One used to be — a check at the centroid,
 * on both seats — and two art reviews read it as a glyph printed on the painting rather
 * than as map state (PRODUCT principle 1: the map is the stage, chrome stays out of it).
 * The word carries it where a mark would have to: `FOG_STATUS_LABEL` in the fog tool, and
 * the hover, which names the state the click is about to change.
 */
export interface FogLook {
  /** 0 = draw nothing over the room. */
  tintAlpha: number;
  /**
   * The hover highlight, which says the room's state too (D11: "with its current state").
   * One warm-to-cold axis, the map's own: torchlight where the party is standing in the
   * light, drained parchment for a memory, cold slate for a
   * room no one has ever lit. Full-strength stroke on all three; the DM's cursor is never
   * ghosted to say something is hidden (PRODUCT principle 3).
   */
  hoverColor: number;
  /**
   * …and how heavy its fill is. This is a legibility correction, not a second reading of the
   * state: the highlight sits above a room already carrying `tintAlpha` of near-black, so the
   * fill climbs with that tint to land the same lift on all three. What actually seconds the
   * colour is underneath it — the hover draws *over* the tint, never instead of it, so a DM
   * who cannot separate the three hues still reads three rooms.
   */
  hoverAlpha: number;
}

export const DM_FOG_LOOK: Record<RoomFogStatus, FogLook> = {
  never_revealed: { tintAlpha: 0.62, hoverColor: 0x9fb2cc, hoverAlpha: 0.18 },
  revealed: { tintAlpha: 0, hoverColor: 0xf0a252, hoverAlpha: 0.1 },
  re_hidden: { tintAlpha: 0.32, hoverColor: 0xd8cfc0, hoverAlpha: 0.14 },
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

/**
 * The doors the *server* is fogging by, at the state the table is playing them — the room
 * graph half of the same rule as {@link serverRooms}.
 *
 * `roomA`/`roomB` are what the concealment BFS walks (D3), and they are exactly the field
 * core does not preserve: `roomSync` re-detects rooms after every load and rewrites both on
 * every door from whatever geometry *this tab* holds. A player's copy is a partial map with
 * no merged floor at all (the server ships `mergedFloor: null`, `redactMapForViewer`), so the
 * ids it derives are its own — and a BFS run over them can reach a room the referee sealed,
 * or seal one the referee opened. Room ids only happen to line up when the whole map is
 * present, which is the DM's case and no player's.
 *
 * The document's own door records carry the ids the server redacted and reachability-tested
 * with, so both seats answer "what does this door join" the same way. Live state still comes
 * off the session's `doors` slice — that half never drifted.
 */
export function serverDoors(
  mapData: unknown,
  doorsState: DoorsState | undefined,
  sceneId: string | null | undefined,
): LiveDoor[] {
  const layers = (mapData as { layers?: Layer[] } | null)?.layers;
  return liveDoors(layers ?? [], doorsState, sceneId);
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
