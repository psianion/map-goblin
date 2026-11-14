// Floor pieces. Everything floor-like on a layer is a `ShapeChild`, drawn in `children`
// order so the top one wins. A piece is one of two things: a walled floor (no `ground`
// flag: it joins the layer's floor union, so walls, rooms, doors, fog and light see it) or
// ground (`ground: true`: paint only, in no union and no room). Under them all lies the
// map's base ground, which is no piece at all.

import type { Polygon } from '../types/geometry';
import type { AnyChild, BaseGround, Level, ShapeChild } from './types';
import { shapeRing } from './plateaus';

/** A ground piece: paint only, never a wall or a room. */
export function isGroundPiece(c: AnyChild): c is ShapeChild {
  return c.childType === 'shape' && c.ground === true;
}

/** A piece's rings as it is drawn (flattened, its transform baked in): the outer ring, then its holes. */
export function pieceRings(shape: ShapeChild): Polygon[] {
  return shape.contours.map((_, k) => shapeRing(shape, k));
}

function inRing(x: number, y: number, ring: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Whether a piece covers a point: inside its outer ring and in none of its own holes. */
export function pieceCovers(shape: ShapeChild, x: number, y: number): boolean {
  const [outer, ...holes] = pieceRings(shape);
  if (!outer || outer.length < 3 || !inRing(x, y, outer)) return false;
  return !holes.some((h) => inRing(x, y, h));
}

/** Inside a set of rings by even-odd, as a floor union is read. */
export function inRingsEvenOdd(x: number, y: number, rings: readonly Polygon[]): boolean {
  let hit = false;
  for (const ring of rings) if (ring.length >= 3 && inRing(x, y, ring)) hit = !hit;
  return hit;
}

/**
 * Whether a piece shows at a point: it covers it, and a patch kept to the floors
 * (`keptToFloors`) on a layer that has any is on the walled union there too.
 */
export function pieceShowsAt(shape: ShapeChild, floor: readonly Polygon[] | null | undefined, x: number, y: number): boolean {
  if (!pieceCovers(shape, x, y)) return false;
  return !shape.keptToFloors || !floor || floor.length === 0 || inRingsEvenOdd(x, y, floor);
}

/** The base ground a level draws: its own when it carries one (null = none), else the map's. */
export function baseGroundOf(map: { ground?: BaseGround | null }, level?: Pick<Level, 'ground'> | null): BaseGround | null {
  const ground = level && level.ground !== undefined ? level.ground : map.ground;
  if (!ground || (!ground.textureId && !ground.color)) return null;
  return ground;
}

/** The frame of a size-locked map (`fixedSize.locked`), anchored at the origin; null for a map that grows. */
export function lockedFrame(map: { fixedSize?: { width: number; height: number; locked?: true } | null }): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const size = map.fixedSize;
  return size && size.locked ? { minX: 0, minY: 0, maxX: size.width, maxY: size.height } : null;
}

/** A frame as a ring, for clipping. */
export function frameRing(f: { minX: number; minY: number; maxX: number; maxY: number }): Polygon {
  return [
    [f.minX, f.minY],
    [f.maxX, f.minY],
    [f.maxX, f.maxY],
    [f.minX, f.maxY],
  ];
}

/** Whether a point lies on a frame (its edge included). */
export function inFrame(f: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number): boolean {
  return x >= f.minX && x <= f.maxX && y >= f.minY && y <= f.maxY;
}
