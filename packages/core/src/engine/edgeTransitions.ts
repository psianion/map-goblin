/**
 * Edge transition detection and rendering.
 *
 * Detects boundaries between shapes with different textures and renders
 * semi-transparent blend strips along those edges. Uses AABB pre-filtering
 * to avoid O(n²) Clipper2 calls — only tests pairs whose bounding boxes
 * overlap within the transition width.
 */

import { Container, Graphics } from 'pixi.js';
import type { ShapeChild, DungeonLayer } from '../store/types';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import type { Polygon } from '../types/geometry';

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeAABB(points: [number, number][]): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function aabbOverlap(a: AABB, b: AABB, margin: number): boolean {
  return (
    a.minX - margin <= b.maxX &&
    a.maxX + margin >= b.minX &&
    a.minY - margin <= b.maxY &&
    a.maxY + margin >= b.minY
  );
}

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Resolve the effective texture identity for a shape.
 * Shapes without a textureId are considered "solid color" (null).
 */
function shapeTextureKey(shape: ShapeChild): string | null {
  return shape.textureId ?? null;
}

export interface TransitionStrip {
  polygons: Polygon[];
  colorA: string;
  colorB: string;
}

/**
 * Detect edge transitions between adjacent shapes with different textures.
 * Returns polygonal strips along the boundaries.
 *
 * Algorithm:
 * 1. AABB pre-filter: skip pairs whose bboxes don't overlap within transitionWidth
 * 2. For overlapping pairs with different textures:
 *    a. Inflate shape A outward by transitionWidth/2
 *    b. Inflate shape B outward by transitionWidth/2
 *    c. Intersect the inflated regions — this gives the transition strip
 */
export function detectEdgeTransitions(
  shapes: ShapeChild[],
  transitionWidth: number,
): TransitionStrip[] {
  if (shapes.length < 2 || transitionWidth <= 0) return [];

  const strips: TransitionStrip[] = [];
  const halfWidth = transitionWidth / 2;

  // Pre-compute AABBs
  const aabbs: AABB[] = shapes.map((s) => computeAABB(s.contours[0]));

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const shapeA = shapes[i];
      const shapeB = shapes[j];

      // Skip pairs with same texture
      const texA = shapeTextureKey(shapeA);
      const texB = shapeTextureKey(shapeB);
      if (texA === texB) continue;

      // AABB pre-filter
      if (!aabbOverlap(aabbs[i], aabbs[j], transitionWidth)) continue;

      // Skip shapes with too few points
      if (shapeA.contours[0].length < 3 || shapeB.contours[0].length < 3) continue;

      // Inflate both shapes and intersect
      const inflatedA = clipper2Engine.inflate([shapeA.contours[0]], halfWidth);
      const inflatedB = clipper2Engine.inflate([shapeB.contours[0]], halfWidth);

      if (inflatedA.length === 0 || inflatedB.length === 0) continue;

      const intersection = clipper2Engine.intersection(inflatedA, inflatedB);
      if (intersection.length === 0) continue;

      strips.push({
        polygons: intersection,
        colorA: shapeA.textureTint,
        colorB: shapeB.textureTint,
      });
    }
  }

  return strips;
}

/**
 * Render edge transition strips into the floor sublayer.
 * Strips are rendered as semi-transparent filled polygons
 * that blend the colors of adjacent texture regions.
 */
export function renderEdgeTransitions(
  parent: Container,
  layer: DungeonLayer,
): void {
  const s = layer.style;
  if (!s.showEdgeTransitions || s.edgeTransitionWidth <= 0) return;
  const shapeChildren = layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
  if (shapeChildren.length < 2) return;

  const strips = detectEdgeTransitions(shapeChildren, s.edgeTransitionWidth);
  if (strips.length === 0) return;

  for (const strip of strips) {
    const g = new Graphics();
    g.alpha = 0.4; // Semi-transparent blend

    for (const poly of strip.polygons) {
      if (poly.length < 3) continue;
      // Blend toward colorB for the transition visual
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        g.lineTo(poly[i][0], poly[i][1]);
      }
      g.closePath();
      g.fill({ color: parseColor(strip.colorB) });
    }

    parent.addChild(g);
  }
}
