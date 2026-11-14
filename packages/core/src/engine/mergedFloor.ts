import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';
import { flattenRing } from '../shared/bezier';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { applyShapeTransform as applyTransformToPoints } from '../shared/plateaus';
import { signedArea } from '../shared/floorPieces';

/**
 * Recompute mergedFloor from the walled floors via Clipper2 boolean union.
 * Returns the merged polygons (or null if there is no walled floor).
 * Does NOT call useStore.setState — the caller writes the result to avoid
 * infinite subscription loops.
 *
 * Ground pieces (`ShapeChild.ground`) stay out: they are paint, so no wall, room, door,
 * fog edge or light occluder ever comes from one.
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
    (c): c is ShapeChild => c.childType === 'shape' && c.visible && !c.ground,
  );

  return unionFloor(shapeChildren);
}

/** Which way Clipper winds a filled ring, as `signedArea` reads it; asked once it is loaded. */
let filledSign = 0;
function clipperFilledSign(): number {
  if (filledSign !== 0) return filledSign;
  const square: Polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (!isClipperReady()) return Math.sign(signedArea(square));
  filledSign = Math.sign(signedArea(clipper2Engine.union([square], [])[0] ?? square)) || 1;
  return filledSign;
}

/**
 * The union of the floors, each as its own region: its outer ring less its OWN holes. A hole
 * in one floor cuts no other, so a floor lying under the hole still stands there.
 */
function unionFloor(shapeChildren: ShapeChild[]): Polygon[] | null {
  if (shapeChildren.length === 0) return null;

  // Each shape's rings, flattened with its transform applied
  const outerPaths: Polygon[] = [];
  const holesOf: Polygon[][] = [];

  for (const shape of shapeChildren) {
    const holes: Polygon[] = [];
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
        holes.push(pts); // hole ring
      }
    }
    if (outerPaths.length > holesOf.length) holesOf.push(holes);
  }

  if (!holesOf.some((h) => h.length > 0)) {
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
    return outerPaths.length === 1 ? [outerPaths[0]] : clipper2Engine.union(outerPaths, []);
  }

  // A lone floor with holes: its ring less them, as it always was.
  if (outerPaths.length === 1) return clipper2Engine.difference([outerPaths[0]], holesOf[0]);

  // Several floors, some holed. Each holed floor is cut first, which leaves it wound the
  // way Clipper fills; the whole ones are turned the same way, so no two regions cancel
  // where they overlap under the non-zero rule.
  const sign = clipperFilledSign();
  const regions: Polygon[] = [];
  outerPaths.forEach((outer, i) => {
    if (holesOf[i].length > 0) regions.push(...clipper2Engine.difference([outer], holesOf[i]));
    else regions.push(Math.sign(signedArea(outer)) === sign ? outer : [...outer].reverse());
  });
  return clipper2Engine.union(regions, []);
}
