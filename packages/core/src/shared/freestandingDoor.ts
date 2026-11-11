// Freestanding doors: a door placed anywhere, on a piece of wall of its own exactly its
// width, turned to its own angle. The piece is an ordinary drawn wall, so rendering, light
// blocking, hit tests and the table all treat the door as they treat any door. Pure: the
// Door tool and the card build their commands from these answers.

import type { DoorChild, DungeonLayer, WallSegment } from '../store/types';
import { doorWallId, polylineLength, projectDoorOnto, resolveDoors, resolveWalls } from './wallResolve';
import { snapToNearestWall } from './wallSnap';
import { isOwnPiece } from './doorwaySeal';

/** How far a freestanding door reaches for a wall when it is anchored: one cell. */
export const ANCHOR_REACH = 1;

/** Whether a door stands free: placed so, or on a piece of its own from before the flag. */
export function isFreestanding(layer: DungeonLayer, door: DoorChild): boolean {
  return door.freestanding === true || isOwnPiece(layer, door.id) !== null;
}

/**
 * The piece a freestanding door stands on: a straight wall `width` long, centred on `at`,
 * turned to `angle` (radians), drawn as the Wall tool draws it. The id is left empty.
 */
export function freePiece(
  at: [number, number],
  angle: number,
  width: number,
  look: Pick<WallSegment, 'wallType' | 'direction' | 'color'>,
): WallSegment {
  const [hx, hy] = [(Math.cos(angle) * width) / 2, (Math.sin(angle) * width) / 2];
  return {
    id: '',
    points: [
      [at[0] - hx, at[1] - hy],
      [at[0] + hx, at[1] + hy],
    ],
    wallType: look.wallType,
    direction: look.direction,
    color: look.color,
    roughness: 0,
  };
}

/** Where a door is drawn now, and at what angle (radians). */
export function doorPlacement(layer: DungeonLayer, door: DoorChild): { position: [number, number]; angle: number } {
  const r = resolveDoors(layer, resolveWalls(layer)).find((x) => x.door.id === door.id);
  return { position: r?.position ?? door.position, angle: r?.angle ?? door.angle };
}

/**
 * Where anchoring puts a freestanding door: onto the nearest wall within one cell of it,
 * other than its own piece, long enough to take it. Null when there is none.
 */
export function anchorFor(
  layer: DungeonLayer,
  door: DoorChild,
): Pick<DoorChild, 'wallId' | 'position' | 'angle'> | null {
  const own = isOwnPiece(layer, door.id)?.id ?? (door.freestanding ? door.wallId : null);
  const walls = resolveWalls(layer).filter((w) => w.id !== own && polylineLength(w.points) >= door.width - 1e-6);
  const at = doorPlacement(layer, door).position;
  const snap = snapToNearestWall(at, walls, ANCHOR_REACH);
  const wall = snap ? walls.find((w) => w.id === snap.wallId) : undefined;
  if (!snap || !wall) return null;
  const placed = projectDoorOnto(door, wall, snap.position);
  return {
    wallId: doorWallId(wall),
    position: placed.position,
    angle: placed.angle,
  };
}
