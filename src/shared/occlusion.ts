import type { WallSegment, DoorChild, WallType, WallDirection } from './types';

export interface OcclusionSegment {
  points: [number, number][];
  blocksVision: boolean;
  blocksLight: boolean;
  blocksMovement: boolean;
  blocksSound: boolean;
  direction: WallDirection;
  sourceType: 'wall' | 'door';
  sourceId: string;
}

interface OcclusionProps {
  blocksVision: boolean;
  blocksLight: boolean;
  blocksMovement: boolean;
  blocksSound: boolean;
}

export const WALL_TYPE_OCCLUSION: Record<WallType, OcclusionProps> = {
  normal:    { blocksVision: true,  blocksLight: true,  blocksMovement: true,  blocksSound: true },
  terrain:   { blocksVision: false, blocksLight: false, blocksMovement: true,  blocksSound: false },
  invisible: { blocksVision: false, blocksLight: false, blocksMovement: true,  blocksSound: false },
  ethereal:  { blocksVision: true,  blocksLight: true,  blocksMovement: false, blocksSound: false },
  window:    { blocksVision: true,  blocksLight: false, blocksMovement: true,  blocksSound: false },
};

const DOOR_OPEN: OcclusionProps = {
  blocksVision: false, blocksLight: false, blocksMovement: false, blocksSound: false,
};
// Design choice: closed doors muffle sound (D&D 5e RAW — closed doors provide
// cover and reduce sound; locked doors are simply closed doors that can't be
// pushed open). If granular audio attenuation is added later, blocksSound can
// be replaced with a numeric attenuation factor instead of a boolean.
const DOOR_CLOSED: OcclusionProps = {
  blocksVision: true, blocksLight: true, blocksMovement: true, blocksSound: true,
};

function getDoorOcclusion(door: DoorChild): OcclusionProps {
  if (door.style === 'archway') return DOOR_OPEN;
  return door.state === 'open' ? DOOR_OPEN : DOOR_CLOSED;
}

function lerp2d(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function segmentLength(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function projectOntoSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

const MIN_SEGMENT_LENGTH = 0.01;

/**
 * Build occlusion segments from standalone walls, splitting each wall at door
 * positions so the lighting engine and VTT export receive per-segment props.
 *
 * NOTE (H8): This function only receives standalone walls. Auto-walls (floor
 * polygon edges) are NOT included here. The lighting raycaster handles auto-walls
 * separately via `extractWallSegments` in `src/engine/lighting/raycaster.ts`,
 * which already combines both sources. The occlusion cache is currently used
 * only for door splitting on standalone walls — auto-wall occlusion goes through
 * the raycaster path and is unaffected by this limitation.
 * TODO: When UVTT export is implemented (Month 4), merge auto-wall edges here
 * so the full wall set is available for UVTT wall embedding.
 *
 * NOTE (M11): Polyline walls (3+ points) are currently treated as a single chord
 * from points[0] to points[last] for the purpose of door projection. Doors placed
 * on intermediate segments will project onto the wrong span and produce inaccurate
 * split intervals. To fix: iterate consecutive point pairs, project the door onto
 * each sub-segment, and emit one set of wall/door segments per sub-segment.
 * Deferred because polyline walls with mid-segment doors are an uncommon case and
 * the fix requires non-trivial restructuring of the interval logic below.
 */
export function buildOcclusionSegments(
  walls: WallSegment[],
  doors: DoorChild[],
): OcclusionSegment[] {
  const doorsByWall = new Map<string, DoorChild[]>();
  for (const door of doors) {
    const list = doorsByWall.get(door.wallId);
    if (list) list.push(door);
    else doorsByWall.set(door.wallId, [door]);
  }

  const result: OcclusionSegment[] = [];

  for (const wall of walls) {
    const wallDoors = doorsByWall.get(wall.id);
    const start = wall.points[0];
    const end = wall.points[wall.points.length - 1];
    const wallLen = segmentLength(start, end);
    const wallOcclusion = WALL_TYPE_OCCLUSION[wall.wallType];

    if (!wallDoors || wallDoors.length === 0 || wallLen < MIN_SEGMENT_LENGTH) {
      result.push({
        points: [start, end],
        ...wallOcclusion,
        direction: wall.direction,
        sourceType: 'wall',
        sourceId: wall.id,
      });
      continue;
    }

    const doorIntervals: { tStart: number; tEnd: number; door: DoorChild }[] = [];
    for (const door of wallDoors) {
      const tCenter = projectOntoSegment(door.position, start, end);
      const halfT = (door.width / 2) / wallLen;
      doorIntervals.push({
        tStart: Math.max(0, tCenter - halfT),
        tEnd: Math.min(1, tCenter + halfT),
        door,
      });
    }

    doorIntervals.sort((a, b) => a.tStart - b.tStart);

    let cursor = 0;
    for (const { tStart, tEnd, door } of doorIntervals) {
      if (tStart > cursor + MIN_SEGMENT_LENGTH / wallLen) {
        const segStart = lerp2d(start, end, cursor);
        const segEnd = lerp2d(start, end, tStart);
        if (segmentLength(segStart, segEnd) > MIN_SEGMENT_LENGTH) {
          result.push({
            points: [segStart, segEnd],
            ...wallOcclusion,
            direction: wall.direction,
            sourceType: 'wall',
            sourceId: wall.id,
          });
        }
      }

      const doorStart = lerp2d(start, end, tStart);
      const doorEnd = lerp2d(start, end, tEnd);
      // Skip zero-length door segments (zero-width door)
      if (segmentLength(doorStart, doorEnd) > MIN_SEGMENT_LENGTH) {
        result.push({
          points: [doorStart, doorEnd],
          ...getDoorOcclusion(door),
          direction: 'both',
          sourceType: 'door',
          sourceId: door.id,
        });
      }

      cursor = tEnd;
    }

    if (cursor < 1 - MIN_SEGMENT_LENGTH / wallLen) {
      const segStart = lerp2d(start, end, cursor);
      if (segmentLength(segStart, end) > MIN_SEGMENT_LENGTH) {
        result.push({
          points: [segStart, end],
          ...wallOcclusion,
          direction: wall.direction,
          sourceType: 'wall',
          sourceId: wall.id,
        });
      }
    }
  }

  return result;
}
