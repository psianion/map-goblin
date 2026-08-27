import { clipper2Engine } from '../geometry/Clipper2Engine';
import { flattenRing } from '../shared/bezier';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';

function applyTransformToPoints(pts: Polygon, t: { translate: [number, number]; rotate: number; scale: [number, number] }): Polygon {
  return pts.map(([x, y]) => {
    let px = x * t.scale[0];
    let py = y * t.scale[1];
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx + t.translate[0];
    py = ry + t.translate[1];
    return [px, py] as [number, number];
  });
}

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
