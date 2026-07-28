import type { DoorChild, Room, WallSegment } from './types';
import { projectPointOntoLineSegment } from './wallSnap';
import { pointInPolygon } from '../engine/hitTest';

/**
 * Direction of the wall polyline at the door, as a unit vector.
 * Walls are polylines, so we use the segment nearest the door rather than the
 * first→last chord. Falls back to `door.angle` when the wall is gone.
 */
function wallDirectionAt(door: DoorChild, wall: WallSegment | undefined): [number, number] {
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  const pts = wall?.points ?? [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const { distance } = projectPointOntoLineSegment(door.position, pts[i], pts[i + 1]);
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-6 && distance < bestDist) {
      bestDist = distance;
      best = [dx / len, dy / len];
    }
  }
  return best ?? [Math.cos(door.angle), Math.sin(door.angle)];
}

function roomAt(point: [number, number], rooms: Room[]): string | null {
  for (const room of rooms) {
    if (pointInPolygon(point, room.boundary)) return room.id;
  }
  return null;
}

/**
 * Bind a door to the rooms on either side of its wall by stepping
 * perpendicularly off the wall and testing which room polygon contains
 * each probe point. `null` on a side means exterior (no room there).
 *
 * ponytail: fixed 0.5-world-unit probe. Corridors narrower than ~0.5 units
 * after wall thickness need a width-derived offset — pass one explicitly.
 */
export function bindDoorToRooms(
  door: DoorChild,
  walls: WallSegment[],
  rooms: Room[],
  offset = 0.5,
): { roomA: string | null; roomB: string | null } {
  const [dx, dy] = wallDirectionAt(door, walls.find((w) => w.id === door.wallId));
  const nx = -dy * offset;
  const ny = dx * offset;
  const [px, py] = door.position;
  return {
    roomA: roomAt([px + nx, py + ny], rooms),
    roomB: roomAt([px - nx, py - ny], rooms),
  };
}
