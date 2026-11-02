/**
 * Edge transition detection and rendering.
 *
 * Where two floor shapes of different textures meet, the shape drawn on top lays its
 * texture's edge strip (`<material>_edge_2x1`, see packCatalog.floorEdgeStrip) along the
 * shared boundary, out over the shape beneath. A texture without one falls back to a
 * semi-transparent colour blend strip. Uses AABB pre-filtering to avoid O(n²) Clipper2
 * calls — only tests pairs whose bounding boxes overlap within the transition width.
 * Paths never take part: they carry their own edge strips.
 */

import { Container, Graphics } from 'pixi.js';
import { floorEdgeStrip, getCatalogEntry } from '../assets/packCatalog';
import { pointInRing } from '../shared/roomUtils';
import { buildEdgeStrips, sampleCentreline } from '../geometry/ribbon';
import { getAssetPackManager } from './assetPackInstance';
import { ribbonMeshObject } from './path/ribbonShader';
import { armLateTextureRebuild } from './floorWallRenderer';
import type { ShapeChild, DungeonLayer } from '../store/types';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { flattenRing } from '../shared/bezier';
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

  // Flatten once up front: transition strips must hug the drawn boundary of a
  // curved room, not the straight chords between its anchors.
  const rings: Polygon[] = shapes.map((s) => flattenRing(s.contours[0] ?? [], s.tangents?.[0]));

  // Pre-compute AABBs
  const aabbs: AABB[] = rings.map((r) => computeAABB(r));

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
      if (rings[i].length < 3 || rings[j].length < 3) continue;

      // Inflate both shapes and intersect
      const inflatedA = clipper2Engine.inflate([rings[i]], halfWidth);
      const inflatedB = clipper2Engine.inflate([rings[j]], halfWidth);

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

/** Twice the signed area: its sign says which side of travel the ring's inside is on. */
function signedArea2(ring: Polygon): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

/**
 * The stretches of `ring` (the top shape's) that lie over or against `bottom`: the ring is cut
 * into pieces no longer than `step`, each piece is probed a little outside its middle, and
 * runs of pieces whose probe lands in `bottom` are joined. `closed` when the whole ring
 * qualifies (a shape set inside another).
 */
export function sharedBoundary(ring: Polygon, bottom: Polygon, probe = 0.05, step = 0.25): { chains: Polygon[]; closed: boolean } {
  if (ring.length < 3 || bottom.length < 3) return { chains: [], closed: false };
  const top: Polygon = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < pieces; k++) top.push([a[0] + ((b[0] - a[0]) * k) / pieces, a[1] + ((b[1] - a[1]) * k) / pieces]);
  }
  const n = top.length;
  // Left of travel ((-dy, dx)) is inside a ring of positive signed area, so outside is right.
  const out = signedArea2(top) > 0 ? -1 : 1;
  const shared = top.map((a, i) => {
    const b = top[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) return false;
    const nx = (-(b[1] - a[1]) / len) * out;
    const ny = ((b[0] - a[0]) / len) * out;
    return pointInRing((a[0] + b[0]) / 2 + nx * probe, (a[1] + b[1]) / 2 + ny * probe, bottom);
  });
  if (shared.every(Boolean)) return { chains: [[...ring]], closed: true };
  // Start just after an edge that is not shared, so no run is cut in two at the seam.
  const start = shared.findIndex((s) => !s) + 1;
  const chains: Polygon[] = [];
  let run: Polygon | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (shared[i]) {
      run ??= [top[i]];
      run.push(top[(i + 1) % n]);
    } else if (run) {
      chains.push(run);
      run = null;
    }
  }
  if (run) chains.push(run);
  return { chains, closed: false };
}

/** A border a shape lays with its texture's edge strip, over the shape beneath it. */
export interface StripBorder {
  /** Index into the shapes: the shape on top, whose texture's strip it is. */
  top: number;
  /** The shape beneath it. */
  bottom: number;
  stripId: string;
  chains: Polygon[];
  closed: boolean;
}

/**
 * Who borders whom, and how: for each pair of differently textured shapes that touch, the one
 * drawn later (on top) lays its texture's edge strip along their shared boundary when its pack
 * ships one (`stripOf`); otherwise the pair gets the colour blend.
 */
export function planEdgeBorders(
  shapes: ShapeChild[],
  transitionWidth: number,
  stripOf: (shape: ShapeChild) => string | undefined,
): { strips: StripBorder[]; blends: ShapeChild[][] } {
  const strips: StripBorder[] = [];
  const blends: ShapeChild[][] = [];
  const rings: Polygon[] = shapes.map((s) => flattenRing(s.contours[0] ?? [], s.tangents?.[0]));
  const aabbs = rings.map((r) => computeAABB(r));
  for (let j = 1; j < shapes.length; j++) {
    for (let i = 0; i < j; i++) {
      if (shapeTextureKey(shapes[i]) === shapeTextureKey(shapes[j])) continue;
      if (!aabbOverlap(aabbs[i], aabbs[j], transitionWidth)) continue;
      if (rings[i].length < 3 || rings[j].length < 3) continue;
      const stripId = stripOf(shapes[j]);
      if (!stripId) {
        blends.push([shapes[i], shapes[j]]);
        continue;
      }
      const { chains, closed } = sharedBoundary(rings[j], rings[i]);
      if (chains.length > 0) strips.push({ top: j, bottom: i, stripId, chains, closed });
    }
  }
  return { strips, blends };
}

/** The colour blend strips for the pairs that have no edge strip. */
function drawBlends(parent: Container, pairs: ShapeChild[][], width: number): void {
  for (const strip of pairs.flatMap((pair) => detectEdgeTransitions(pair, width))) {
    const g = new Graphics();
    g.alpha = 0.4; // Semi-transparent blend
    for (const poly of strip.polygons) {
      if (poly.length < 3) continue;
      // Blend toward colorB for the transition visual
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      g.closePath();
      g.fill({ color: parseColor(strip.colorB) });
    }
    parent.addChild(g);
  }
}

/**
 * Render the borders between differently textured floor shapes into the floor sublayer: an
 * edge strip ribbon where the top shape's texture has one, the colour blend where not. A
 * strip whose art has not arrived yet draws the blend and asks for a re-bake when it lands.
 */
export function renderEdgeTransitions(parent: Container, layer: DungeonLayer): void {
  const s = layer.style;
  if (!s.showEdgeTransitions || s.edgeTransitionWidth <= 0) return;
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
  if (shapes.length < 2) return;

  const { strips, blends } = planEdgeBorders(shapes, s.edgeTransitionWidth, (shape) => floorEdgeStrip(shape.textureId)?.id);
  for (const border of strips) {
    const texture = getAssetPackManager().getTextureOrNull(border.stripId);
    const top = shapes[border.top];
    if (!texture || texture.width <= 1) {
      armLateTextureRebuild(layer.id, border.stripId);
      blends.push([shapes[border.bottom], top]);
      continue;
    }
    const outward = signedArea2(flattenRing(top.contours[0] ?? [], top.tangents?.[0])) > 0 ? 'right' : 'left';
    for (const chain of border.chains) {
      const line = sampleCentreline(chain.map(([x, y]) => ({ x, y, handles: null })), border.closed, 0);
      const side = buildEdgeStrips(line, s.edgeTransitionWidth)[outward];
      side.width.fill(s.edgeTransitionWidth);
      const fade = border.closed ? 0 : Math.min(0.5, line.length / 4);
      const mesh = ribbonMeshObject(side, texture, {
        stripLength: parseInt(getCatalogEntry(border.stripId)?.gridSize.split('x')[0] ?? '2', 10) || 2,
        tint: parseColor(top.textureTint || '#ffffff'),
        opacity: 1,
        soft: false,
        edgeWidth: 0,
        fadeStart: fade > 0,
        fadeEnd: fade > 0,
        fadeLength: fade,
        length: line.length,
        flip: false,
        water: false,
      });
      if (mesh) parent.addChild(mesh);
    }
  }
  drawBlends(parent, blends, s.edgeTransitionWidth);
}
