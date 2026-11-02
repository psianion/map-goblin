import { clipper2Engine } from '../geometry/Clipper2Engine';
import { flattenRing } from '../shared/bezier';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { applyShapeTransform as applyTransformToPoints, hasPlateaus, layerPlateaus, wallBandRings } from '../shared/plateaus';

/**
 * Recompute mergedFloor from shape children via Clipper2 boolean union.
 * Returns the merged polygons (or null if no shapes).
 * Does NOT call useStore.setState — the caller writes the result to avoid
 * infinite subscription loops.
 *
 * Lives outside subscribeToStore so the floor rebuild itself can heal a null
 * union: a map load replaces the layers wholesale with `mergedFloor: null`
 * (files and session payloads both ship it stripped), and the subscriber that
 * normally recomputes it skips layers whose scene entry hasn't been rebuilt
 * yet — with no later store write touching its selector, the union stayed null
 * and every floor on the map rendered as void.
 */
export function computeMergedFloor(layer: DungeonLayer): Polygon[] | null {
  const shapeChildren = layer.children.filter(
    (c): c is ShapeChild => c.childType === 'shape' && c.visible,
  );

  if (shapeChildren.length === 0) return null;
  if (hasPlateaus(layer)) return plateauFloor(layer);
  return unionFloor(shapeChildren);
}

/**
 * A layer with raised floors: the ground's union (the floors standing on no plateau),
 * then the rings of every raised band that keeps its walls (a raised room), appended so
 * the ground's ring indices, which stone edits key on, stay where they were. A cliff,
 * slope or bare edge is in it only where its ring stands on void (a cave floor raised or
 * sunk on its own); standing on lower ground it makes no walls and no rooms
 * (shared/plateaus.ts `wallBandRings`).
 */
function plateauFloor(layer: DungeonLayer): Polygon[] | null {
  const plateaus = layerPlateaus(layer);
  const ground = unionFloor(plateaus.ground) ?? [];
  const out = [...ground, ...wallBandRings(plateaus)];
  return out.length > 0 ? out : null;
}

/** The plain union of floors: every outer ring unioned, every hole subtracted. */
function unionFloor(shapeChildren: ShapeChild[]): Polygon[] | null {
  if (shapeChildren.length === 0) return null;

  // Collect outer rings and hole rings separately, applying transforms
  const outerPaths: Polygon[] = [];
  const holePaths: Polygon[] = [];

  for (const shape of shapeChildren) {
    for (let i = 0; i < shape.contours.length; i++) {
      // Curved edges flatten here, before anything downstream sees the ring —
      // walls, fog, rooms and hit tests all read mergedFloor. Straight rings
      // (no tangents) pass through untouched.
      let pts = flattenRing(shape.contours[i], shape.tangents?.[i]);
      if (shape.transform) {
        pts = applyTransformToPoints(pts, shape.transform);
      }
      if (i === 0) {
        outerPaths.push(pts); // outer boundary
      } else {
        holePaths.push(pts); // hole ring
      }
    }
  }

  // Union every outer ring in one call. UnionD's NonZero fill merges the
  // subjects against each other as well as against the (empty) clip set, so
  // this is the same answer the left fold it replaces produced — for N shapes
  // in one WASM round trip instead of N-1, which is where a dressed map's
  // ~280ms went.
  //
  // ponytail: a lone ring is still handed back untouched rather than round
  // tripped for normalisation, exactly as the fold did. The ring's winding
  // reaches `seedForPoints`, so normalising it would relay every stone on a
  // one-shape map to change nothing visible.
  let merged: Polygon[] =
    outerPaths.length === 1 ? [outerPaths[0]] : clipper2Engine.union(outerPaths, []);

  // Subtract all hole rings from the merged result
  if (holePaths.length > 0) {
    merged = clipper2Engine.difference(merged, holePaths);
  }

  return merged;
}
