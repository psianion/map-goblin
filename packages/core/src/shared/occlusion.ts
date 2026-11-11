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
  // Sight and light both pass a window (the Lighting pass made the table match the editor).
  window:    { blocksVision: false, blocksLight: false, blocksMovement: true,  blocksSound: false },
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
 * Build occlusion segments from resolved walls, splitting each wall at door
 * positions so the lighting engine and VTT export receive per-segment props.
 *
 * Both wall kinds arrive here: `resolveWalls` in `shared/wallResolve.ts` hands
 * over standalone segments *and* floor-ring edges, and `toOcclusionDoors` hands
 * over doors already projected onto them (detached ones dropped). Doors are
 * matched to walls by id, so pass resolved doors rather than raw children —
 * a floor door stores no wall id of its own.
 *
 * A polyline wall (3+ points: a clicked chain, a freehand stroke, a closed ring)
 * follows its points: every run is its own segment, and each door is projected
 * onto the polyline and cut out of it by arc length (`polylineSegments`), so a
 * door on any run splits that run and a ring blocks all the way round.
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
    if (wall.points.length > 2) {
      result.push(...polylineSegments(wall, wallDoors ?? []));
      continue;
    }
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

/**
 * A polyline wall's segments: one per run, with each door's span (centred on its
 * projection onto the polyline, by arc length) cut out as door segments along
 * whichever runs it covers. The same rules as a two-point wall, measured along
 * the polyline instead of its chord.
 */
function polylineSegments(wall: WallSegment, doors: DoorChild[]): OcclusionSegment[] {
  const pts = wall.points;
  const at: number[] = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + segmentLength(pts[i - 1], pts[i]));
  const total = at[at.length - 1];
  const out: OcclusionSegment[] = [];
  const wallProps = { ...WALL_TYPE_OCCLUSION[wall.wallType], direction: wall.direction, sourceType: 'wall' as const, sourceId: wall.id };

  /** The runs between arc lengths s0 and s1, one 2-point segment per run they cover. */
  const pushSpan = (s0: number, s1: number, props: Omit<OcclusionSegment, 'points'>) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = at[i + 1] - at[i];
      const a = Math.max(s0, at[i]);
      const b = Math.min(s1, at[i + 1]);
      if (len <= 0 || b - a <= 0) continue;
      out.push({ points: [lerp2d(pts[i], pts[i + 1], (a - at[i]) / len), lerp2d(pts[i], pts[i + 1], (b - at[i]) / len)], ...props });
    }
  };

  if (doors.length === 0 || total < MIN_SEGMENT_LENGTH) {
    pushSpan(0, total, wallProps);
    return out;
  }

  const intervals = doors
    .map((door) => {
      const s = projectOntoPolyline(door.position, pts, at);
      return { sStart: Math.max(0, s - door.width / 2), sEnd: Math.min(total, s + door.width / 2), door };
    })
    .sort((a, b) => a.sStart - b.sStart);

  let cursor = 0;
  for (const { sStart, sEnd, door } of intervals) {
    if (sStart > cursor + MIN_SEGMENT_LENGTH) pushSpan(cursor, sStart, wallProps);
    if (sEnd - sStart > MIN_SEGMENT_LENGTH) {
      pushSpan(sStart, sEnd, { ...getDoorOcclusion(door), direction: 'both', sourceType: 'door', sourceId: door.id });
    }
    cursor = sEnd;
  }
  if (cursor < total - MIN_SEGMENT_LENGTH) pushSpan(cursor, total, wallProps);
  return out;
}

/** The arc length along `pts` (cumulative lengths `at`) of the point nearest `point`. */
function projectOntoPolyline(point: [number, number], pts: [number, number][], at: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const t = projectOntoSegment(point, pts[i], pts[i + 1]);
    const p = lerp2d(pts[i], pts[i + 1], t);
    const d = segmentLength(point, p);
    if (d < bestD) {
      bestD = d;
      best = at[i] + t * (at[i + 1] - at[i]);
    }
  }
  return best;
}
