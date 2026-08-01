// The doors UI's arithmetic and vocabulary — Pixi-free and DOM-free, so both the canvas
// layer and the panel can be checked without either.
//
// Authored doors come off the loaded map (D2: the map file is the default); live state
// comes off the session's `doors` slice, seeded from the authored data by the same
// function the server seeds with.

import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import {
  DOOR_CLOSED,
  DOOR_LOCKED,
  UNKNOWN_DOOR,
  doorsOfScene,
  refusalSubject,
  type DoorLiveState,
  type DoorsState,
} from '@dnd/mechanics/doors';

/** A door and the state the table is playing it at. */
export interface LiveDoor {
  door: DoorChild;
  live: DoorLiveState;
}

/**
 * PRODUCT principle 3, as a number. Nothing on the DM's view is ever ghosted to say it is
 * hidden — the badge says it, at full strength, over the fog tint. Owlbear's habit of
 * fading the DM's own secrets is the anti-reference this exists to refuse.
 */
export const DM_ENTITY_ALPHA = 1;

export type DoorBadge = 'secret' | null;

export interface DoorLook {
  color: number;
  alpha: number;
  /** Filled disc = shut, ring = open. Shape carries the state, colour only seconds it. */
  filled: boolean;
  badge: DoorBadge;
}

/** Warm parchment, the map's own ink language rather than a UI palette. */
const DOOR_COLOR = 0xe0d6c3;
/**
 * Warm gold — the art guide's own accent for a stone interior ("warm orange/gold accents
 * only at light sources and treasure"), which is the register a secret belongs in. Not a
 * status colour: it is the one mark on the canvas the guide's palette already has a place
 * for, and it is the DM's alone.
 */
const SECRET_COLOR = 0xe0b252;

/**
 * How one door draws.
 *
 * Two looks, and neither is a status colour over the door art. There used to be a third: a
 * locked door came back saturated red on both seats, which put a UI alert on top of a
 * hand-painted map (PRODUCT principle 1 — the map is the stage) and said "locked" in nothing
 * but hue. Locked is a *panel* state now: the door rows name it in words and the toast names
 * it again when a player bumps one, which is where a player can actually act on it. On the
 * canvas a locked door is a door.
 *
 * What is left is the neutral mark every player ever sees, and the DM's secret badge —
 * PRODUCT principle 3, full opacity and a badge rather than a ghost. A player never receives
 * an unrevealed secret door at all (D4), so that branch cannot be reached from a player's
 * seat and no seat argument is needed to keep their canvas free of state colour.
 */
export function doorLook(door: DoorChild, live: DoorLiveState): DoorLook {
  if (door.isSecret && !live.revealed) {
    return { color: SECRET_COLOR, alpha: DM_ENTITY_ALPHA, filled: !live.open, badge: 'secret' };
  }
  return { color: DOOR_COLOR, alpha: DM_ENTITY_ALPHA, filled: !live.open, badge: null };
}

/** The words under the mark — state is never left to colour alone. */
export function doorStatusLabel(door: DoorChild, live: DoorLiveState): string {
  const parts = [live.open ? 'Open' : 'Closed'];
  if (live.locked) parts.push('locked');
  if (door.isSecret) parts.push(live.revealed ? 'secret, revealed' : 'secret');
  return parts.join(' · ');
}

/** The author's own name for the door ("Reliquary Door"), else a stable fallback. */
export const doorLabel = (door: DoorChild, index: number): string =>
  door.name?.trim() || `Door ${index + 1}`;

/**
 * The refusals a door hands back, in words a player can act on — or null for anything that
 * is not a door's business. Matched on the exported prefixes rather than the sentence: the
 * wire's `code` is `invalid-command` for every rejection, so the constant at the head of
 * the message is the real discriminator.
 *
 * The refusal carries the door's *id*; the name comes from `doors` — the same list this
 * seat's panel and canvas are drawing, already cut by the server's redactor. So a door the
 * player has earned the name of is named, and one whose name was withheld (or that this
 * seat does not hold at all) falls back to the nameless sentence rather than to the "Door 3"
 * of `doorLabel`, which would be a worse answer than saying nothing.
 *
 * `unknown-door` is deliberately the same shrug as a stale id, and stays nameless for the
 * same reason. A player probing for the secret door the DM has not revealed must learn
 * nothing from the wording either.
 */
export function doorRefusal(message: string, doors: readonly LiveDoor[] = []): string | null {
  const id = refusalSubject(message);
  const named = doors.find((entry) => entry.door.id === id)?.door.name?.trim();
  if (message.startsWith(DOOR_LOCKED)) return named ? `${named} is locked.` : 'The door is locked.';
  if (message.startsWith(DOOR_CLOSED)) return named ? `${named} is closed.` : 'The door is closed.';
  if (message.startsWith(UNKNOWN_DOOR)) return 'That door is no longer there.';
  return null;
}

/** Hit radius in world units (grid cells) — never smaller than a comfortable click. */
export const doorHitRadius = (door: DoorChild): number => Math.max(door.width / 2, 0.45);

/** The door under a world point, nearest first. */
export function doorAt(doors: readonly LiveDoor[], x: number, y: number): LiveDoor | undefined {
  let best: LiveDoor | undefined;
  let bestDist = Infinity;
  for (const entry of doors) {
    const [dx, dy] = [entry.door.position[0] - x, entry.door.position[1] - y];
    const dist = Math.hypot(dx, dy);
    if (dist > doorHitRadius(entry.door) || dist >= bestDist) continue;
    bestDist = dist;
    best = entry;
  }
  return best;
}

/** Every authored door of the loaded map. Players never receive secret ones. */
export function doorsOfLayers(layers: readonly Layer[]): DoorChild[] {
  return layers.flatMap((layer) =>
    layer.type === 'dungeon'
      ? layer.children.filter((c): c is DoorChild => c.childType === 'door' && c.visible !== false)
      : [],
  );
}

/**
 * The scene's doors at their live state — the one reading of "what are the doors doing"
 * this client has. The lighting lane feeds ClockwiseSweep's wall input from exactly this
 * (D12: a closed door is a wall), which is why it returns authored geometry alongside the
 * overlay instead of the overlay alone.
 */
export function liveDoors(
  layers: readonly Layer[],
  doorsState: DoorsState | undefined,
  sceneId: string | null | undefined,
): LiveDoor[] {
  const authored = doorsOfLayers(layers);
  if (authored.length === 0) return [];
  const live = doorsOfScene(doorsState ?? { byScene: {} }, sceneId ?? '', authored);
  return authored.map((door) => ({ door, live: live[door.id] }));
}
