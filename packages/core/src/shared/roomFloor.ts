import type { DungeonLayer, Layer, MapSettings } from '../store/types';
import type { DoorChild, Level, ShapeChild, ThresholdSegment } from './types';
import type { Polygon } from '../geometry/GeometryEngine';
import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';
import { computeMapFrame, type WorldBounds } from './mapBounds';
import { baseGroundOf, frameRing, isGroundPiece, pieceRings } from './pieces';
import { levelOf } from './lookScope';
import { cutFloor, facesOfParts, wallToRects } from '../engine/roomDetection';
import { computeMergedFloor } from '../engine/mergedFloor';
import { caveCutters } from './caveFloor';
import { patchArea } from './materialPatch';
import { signedArea } from './roomUtils';

/*
 * The floor a layer's rooms sit in (rooms plan §3.2, §3.3). One function feeds Suggest, the
 * editor's sync and the table's server, so a room accepted from a suggestion keeps its face
 * everywhere.
 *
 * On a layer with no standalone wall the faces are what they always were: the walled floor
 * less walls, thresholds and painted caves' edges. On a layer with a wall, ground joins in:
 * the ground pieces, and the map frame when the level has base ground (or the layer has no
 * floor at all, a walls-only import). That ground is cut apart from the walled floor, so a
 * walled floor's faces never change, and a ground face is offered only when it is closed:
 * grown a little, it stays on the floor and the walls. The open outdoors never is.
 *
 * A layer drawn in ground alone (no walled floor, no wall) has no faces here; Suggest reads its
 * painted areas instead (`paintedGroundCuts`) and makes each one an outlined room, so once
 * accepted it is placed by its outline like any other.
 */

/** What a layer's rooms read beyond the layer itself: the map's frame, and whether its level has base ground. */
export interface RoomContext {
  frame: WorldBounds | null;
  baseGround: boolean;
}

/** No frame, no base ground: the walled floor alone, as rooms read it before ground counted. */
export const NO_ROOM_CONTEXT: RoomContext = { frame: null, baseGround: false };

/** How far a ground face is grown to ask whether anything open lies beside it, cells. */
const CLOSED_GROW = 0.2;
/** Leftover area that still counts as nothing, square cells. */
const AREA_EPSILON = 1e-3;

const frameMemo = new WeakMap<readonly Layer[], { settings: MapSettings; frame: WorldBounds | null }>();

/** Frame and base ground for the layer's level, from a document or the store's state. */
export function roomContextOf(
  doc: { layers: readonly Layer[]; mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
): RoomContext {
  const settings = doc.mapSettings;
  // One frame per layers array: a refresh asks once per dungeon layer.
  let hit = frameMemo.get(doc.layers);
  if (!hit || hit.settings !== settings) {
    hit = { settings, frame: computeMapFrame(doc.layers, settings?.terrain?.bounds ?? null, settings?.fixedSize ?? null) };
    frameMemo.set(doc.layers, hit);
  }
  const level = doc.levels && doc.levels.length > 0 ? levelOf(doc.levels, layer) : null;
  return { frame: hit.frame, baseGround: !!baseGroundOf(settings ?? {}, level) };
}

/** The layer's walled floor: its merged floor, unioned here when the layer carries none yet. */
export function walledFloorOf(layer: DungeonLayer): Polygon[] {
  return layer.mergedFloor ?? computeMergedFloor(layer) ?? [];
}

/** A ring wound the way Clipper winds a filled one (positive area). */
function filled(ring: Polygon): Polygon {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Each visible ground piece, in drawing order, as the region it covers (its own holes out), with its texture. Pieces kept to the floors add nothing. */
function groundPieceList(layer: DungeonLayer): { texture: string; rings: Polygon[] }[] {
  const out: { texture: string; rings: Polygon[] }[] = [];
  for (const c of layer.children) {
    if (!isGroundPiece(c) || c.visible === false || (c as ShapeChild).keptToFloors) continue;
    const [outer, ...holes] = pieceRings(c as ShapeChild).filter((r) => r.length >= 3);
    if (!outer) continue;
    const rings = holes.length === 0 ? [filled(outer)] : clipper2Engine.difference([outer], holes);
    out.push({ texture: (c as ShapeChild).textureId ?? '', rings });
  }
  return out;
}

function groundPieces(layer: DungeonLayer): Polygon[] {
  return groundPieceList(layer).flatMap((p) => p.rings);
}

type Box = [number, number, number, number];

function boxOfRings(rings: readonly Polygon[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  return b;
}

/**
 * The cut of a layer drawn in ground alone (no walled floor, no wall), for Suggest: the visible
 * ground as painted, one region per texture (a later piece covers what it lies over), each cut
 * by the divide lines. Pieces of one texture that touch are one area; different textures stay
 * apart. Base ground is never among them. Null on a layer with a walled floor or a wall, where
 * the faces are `roomFaceCut`'s.
 */
export function paintedGroundCuts(layer: DungeonLayer, extraThresholds: readonly ThresholdSegment[] = []): FaceCut[] | null {
  if (layer.standaloneWalls.length > 0 || walledFloorOf(layer).length > 0) return null;
  const areas = new Map<string, { rings: Polygon[]; box: Box }>();
  for (const { texture, rings } of groundPieceList(layer)) {
    const box = boxOfRings(rings);
    for (const [t, area] of areas) {
      if (t === texture || area.rings.length === 0) continue;
      const b = area.box;
      if (box[0] >= b[2] || box[2] <= b[0] || box[1] >= b[3] || box[3] <= b[1]) continue;
      area.rings = clipper2Engine.difference(area.rings, rings);
    }
    const area = areas.get(texture);
    if (!area) areas.set(texture, { rings: [...rings], box });
    else {
      area.rings.push(...rings);
      area.box = [Math.min(area.box[0], box[0]), Math.min(area.box[1], box[1]), Math.max(area.box[2], box[2]), Math.max(area.box[3], box[3])];
    }
  }
  const width = layer.style?.wallWidth ?? 0;
  const divides = [...(layer.thresholds ?? []), ...extraThresholds];
  const out: FaceCut[] = [];
  for (const { rings } of areas.values()) {
    if (rings.length === 0) continue;
    const cut = cutFloor(rings, [], width, divides);
    const faces = facesOfParts(cut, 1);
    if (faces.length > 0) out.push({ faces, rings: cut });
  }
  return out;
}

function wallRects(layer: DungeonLayer): Polygon[] {
  const width = layer.style?.wallWidth ?? 0;
  // Wound like the floor, so a union with it fills rather than cancels where they overlap.
  return layer.standaloneWalls.flatMap((w) => wallToRects(w, width).map(filled));
}

/** A door's cut: a threshold across its width, so a gap a door stands in closes the space behind it. */
function doorCutters(layer: DungeonLayer): ThresholdSegment[] {
  const out: ThresholdSegment[] = [];
  for (const c of layer.children) {
    if (c.childType !== 'door') continue;
    const door = c as DoorChild;
    const [x, y] = door.position;
    const hx = (Math.cos(door.angle) * door.width) / 2;
    const hy = (Math.sin(door.angle) * door.width) / 2;
    out.push({ id: `door:${door.id}`, points: [[x - hx, y - hy], [x + hx, y + hy]] });
  }
  return out;
}

interface GroundFloor {
  /** The ground, each region wound to fill. */
  ground: Polygon[];
  /** The map frame, when the ground is the frame (base ground, or a layer with no floor at all). */
  frame: WorldBounds | null;
}

/** The ground rooms read on a layer with walls, or null where none counts (§3.2). */
function groundFloorOf(layer: DungeonLayer, ctx: RoomContext, walled: Polygon[]): GroundFloor | null {
  if (layer.standaloneWalls.length === 0) return null;
  if (ctx.frame && ctx.baseGround) {
    // Base ground covers the whole frame, so the pieces on it add nothing.
    return { ground: [frameRing(ctx.frame)], frame: ctx.frame };
  }
  const pieces = groundPieces(layer);
  if (pieces.length > 0) return { ground: pieces, frame: null };
  // A walls-only import: the frame stands in for the floor.
  if (walled.length === 0 && ctx.frame) return { ground: [frameRing(ctx.frame)], frame: ctx.frame };
  return null;
}

/** Whether a face's box comes within the closing distance of the frame's edge, so it reaches the open map. */
function nearFrameEdge(face: Polygon, frame: WorldBounds): boolean {
  for (const [x, y] of face) {
    if (x - frame.minX < CLOSED_GROW || frame.maxX - x < CLOSED_GROW || y - frame.minY < CLOSED_GROW || frame.maxY - y < CLOSED_GROW) return true;
  }
  return false;
}

/** Faces and every ring of the cut floor they came from (holes included), for the passage split. */
export interface FaceCut {
  faces: Polygon[];
  rings: Polygon[];
}

/** {@link roomFacesOf}, with the cut floor's rings alongside. */
export function roomFaceCut(layer: DungeonLayer, ctx: RoomContext, extraThresholds: readonly ThresholdSegment[] = []): FaceCut {
  const walled = walledFloorOf(layer);
  const own = walledFaceCut(layer, extraThresholds, walled);
  const ground = groundFaceCut(layer, ctx, extraThresholds, walled);
  return ground ? { faces: [...own.faces, ...ground.faces], rings: [...own.rings, ...ground.rings] } : own;
}

/** The walled floor's faces alone: the walled floor less walls, thresholds and painted caves' edges. */
export function walledFaceCut(
  layer: DungeonLayer,
  extraThresholds: readonly ThresholdSegment[] = [],
  walled: Polygon[] = walledFloorOf(layer),
): FaceCut {
  const width = layer.style?.wallWidth ?? 0;
  const divides = [...(layer.thresholds ?? []), ...extraThresholds];
  const rings = cutFloor(walled, layer.standaloneWalls, width, [...divides, ...caveCutters(layer)]);
  return { faces: facesOfParts(rings, 1), rings };
}

/** The closed faces in a layer's ground (§3.2), cut apart from its walled floor; null where no ground counts. */
export function groundFaceCut(
  layer: DungeonLayer,
  ctx: RoomContext,
  extraThresholds: readonly ThresholdSegment[] = [],
  walled: Polygon[] = walledFloorOf(layer),
): FaceCut | null {
  const ground = groundFloorOf(layer, ctx, walled);
  if (!ground) return null;
  const width = layer.style?.wallWidth ?? 0;
  const divides = [...(layer.thresholds ?? []), ...extraThresholds];

  // The ground is cut on its own, with the walled floor taken out (the plan's thin cut along
  // every walled ring, done exactly): a walled floor's faces stay what they were. A lone
  // merged ring comes back from the union untouched, wound either way.
  const walledFilled = walled.length === 1 ? [filled(walled[0])] : walled;
  // Taken out wound the way the wall and threshold cuts are, so none cancels another where they overlap.
  // This second cut against every wall is what base ground costs a walled dungeon; the sync
  // pays it only when some pin sits off the walled floor (`syncRooms`).
  const walledCut = walledFilled.map((r) => [...r].reverse());
  const groundRings = cutFloor(ground.ground, layer.standaloneWalls, width, [...divides, ...doorCutters(layer)], walledCut);
  let inside: Polygon[] | null = null;
  const closed = facesOfParts(groundRings, 1).filter((face) => {
    // On the frame's ground, a face is open exactly when it reaches the frame's edge.
    if (ground.frame) return !nearFrameEdge(face, ground.frame);
    // On pieces: grown a little, it must stay on the floor, the ground and the walls.
    inside ??= clipper2Engine.union([...walledFilled, ...ground.ground, ...wallRects(layer)], []);
    return patchArea(clipper2Engine.difference(clipper2Engine.inflate([face], CLOSED_GROW), inside)) < AREA_EPSILON;
  });
  return { faces: closed, rings: groundRings };
}

/** Closed faces a room can sit in (plan 3.2), with extra divide lines applied on top of the layer's own. */
export function roomFacesOf(layer: DungeonLayer, ctx: RoomContext, extraThresholds: readonly ThresholdSegment[] = []): Polygon[] {
  return roomFaceCut(layer, ctx, extraThresholds).faces;
}

const standableMemo = new WeakMap<DungeonLayer, { frame: WorldBounds | null; baseGround: boolean; rings: Polygon[] }>();

/** Ground a token can stand on: walled floor, ground pieces and base ground, less the walls. Empty on a picture-only layer. */
function standableOf(layer: DungeonLayer, ctx: RoomContext): Polygon[] {
  const hit = standableMemo.get(layer);
  if (hit && hit.frame === ctx.frame && hit.baseGround === ctx.baseGround) return hit.rings;
  const walled = walledFloorOf(layer);
  const ground = [...(ctx.baseGround && ctx.frame ? [frameRing(ctx.frame)] : []), ...groundPieces(layer)];
  let rings: Polygon[] = [];
  if (walled.length > 0 || ground.length > 0) {
    const floor = clipper2Engine.union([...(walled.length === 1 ? [filled(walled[0])] : walled), ...ground], []);
    const walls = wallRects(layer);
    rings = walls.length > 0 ? clipper2Engine.difference(floor, walls) : floor;
  }
  standableMemo.set(layer, { frame: ctx.frame, baseGround: ctx.baseGround, rings });
  return rings;
}

/** An outline cut down to the standable ground under it (largest part); the outline itself on a picture-only map; null when under 3 points. (plan 3.3) */
export function outlineFace(
  layer: DungeonLayer,
  ctx: RoomContext,
  outline: readonly [number, number][],
): [number, number][] | null {
  if (outline.length < 3) return null;
  const ring = outline.map(([x, y]): [number, number] => [x, y]);
  // Without Clipper nothing can be cut: the outline stands as drawn.
  if (!isClipperReady()) return ring;
  const standable = standableOf(layer, ctx);
  if (standable.length === 0) return ring;
  let best: [number, number][] | null = null;
  let bestArea = AREA_EPSILON;
  for (const part of clipper2Engine.intersection([filled(ring)], standable)) {
    const area = signedArea(part);
    if (part.length >= 3 && area > bestArea) {
      best = part;
      bestArea = area;
    }
  }
  return best;
}
