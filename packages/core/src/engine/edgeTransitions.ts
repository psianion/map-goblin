/**
 * Borders between floors.
 *
 * Where two floor shapes of different textures meet, the top one's kit lays its edge units
 * along the boundary they share (`sharedBoundary`), walked as a path's edge is
 * (path/pathKitLayout `edgeWalk`). Only where the top floor's texture has no kit with edge
 * units does a semi-transparent colour blend strip lie along the boundary instead. Uses AABB
 * pre-filtering to avoid O(n²) Clipper2 calls — only tests pairs whose bounding boxes overlap
 * within the transition width.
 */

import { Container, Graphics } from 'pixi.js';
import { getCatalogEntry, pathKits, type CatalogEntry, type PathKit } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import { edgeWalk, type UnitPlacement } from './path/pathKitLayout';
import { kitEdgeUnits, placePieces, type Piece } from './path/kitUnits';
import { pointInRing } from '../shared/roomUtils';
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

/** The colour blend strips along the boundaries of `pairs`. */
function drawBlends(parent: Container, pairs: ShapeChild[][], width: number): void {
  for (const strip of pairs.flatMap((pair) => detectEdgeTransitions(pair, width))) {
    const g = new Graphics();
    g.label = 'floor-edge-blend';
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
 * The kit a floor texture borders with: the path kit whose fill it is, else the kit of the
 * texture's own material set in its pack. None for a texture no kit claims.
 */
export function floorKit(textureId: string | undefined): PathKit | undefined {
  const entry = textureId ? getCatalogEntry(textureId) : undefined;
  if (!entry) return undefined;
  const kits = pathKits();
  return kits.find((k) => k.fill?.id === entry.id) ?? kits.find((k) => k.packId === entry.packId && !!entry.set && k.set === entry.set);
}

/** Units walked along the boundary one floor (`top`, later in child order) shares with one beneath it. */
export interface FloorBorder {
  top: ShapeChild;
  under: ShapeChild;
  units: UnitPlacement[];
  entries: Map<string, CatalogEntry>;
}

/**
 * Where differently textured floors meet: for each pair, the top floor's kit's edge units
 * walked along the stretch of its outline that lies over or against the floor beneath
 * (`sharedBoundary`), by the paths' edge walk, seeded by the two floors' ids. A pair whose
 * top floor has no kit with edge units falls back to the colour blend.
 */
export function floorBorders(shapes: readonly ShapeChild[], margin: number): { borders: FloorBorder[]; blends: ShapeChild[][] } {
  const borders: FloorBorder[] = [];
  const blends: ShapeChild[][] = [];
  const rings: Polygon[] = shapes.map((s) => flattenRing(s.contours[0] ?? [], s.tangents?.[0]));
  const boxes = rings.map((r) => computeAABB(r));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const under = shapes[i];
      const top = shapes[j];
      if (shapeTextureKey(under) === shapeTextureKey(top)) continue;
      if (rings[i].length < 3 || rings[j].length < 3 || !aabbOverlap(boxes[i], boxes[j], margin)) continue;
      const kit = floorKit(top.textureId);
      const { units, entries } = kit ? kitEdgeUnits(kit) : { units: [], entries: new Map<string, CatalogEntry>() };
      if (units.length === 0) {
        blends.push([under, top]);
        continue;
      }
      const { chains, closed } = sharedBoundary(rings[j], rings[i]);
      if (chains.length === 0) continue;
      borders.push({ top, under, units: edgeWalk(chains, units, `${top.id}|${under.id}`, [], { open: !closed }), entries });
    }
  }
  return { borders, blends };
}

/**
 * Render the borders between differently textured floor shapes into the floor sublayer: the
 * top floor's kit units walked along every boundary two floors share, and the colour blend
 * where the top floor's texture has no kit with edge units. `waitFor` hears of a unit's art
 * that has yet to load.
 */
export function renderEdgeTransitions(parent: Container, layer: DungeonLayer, waitFor?: (textureId: string) => void): void {
  const s = layer.style;
  if (!s.showEdgeTransitions) return;
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
  if (shapes.length < 2) return;
  const { borders, blends } = floorBorders(shapes, Math.max(0.5, s.edgeTransitionWidth));
  if (blends.length > 0 && s.edgeTransitionWidth > 0) drawBlends(parent, blends, s.edgeTransitionWidth);
  const pieces: Piece[] = [];
  for (const b of borders) {
    for (const u of b.units) {
      const entry = b.entries.get(u.key);
      if (!entry) continue;
      if (resolveTexture(entry.id).width <= 1) {
        waitFor?.(entry.id);
        continue;
      }
      pieces.push({ entry, x: u.x, y: u.y, rotation: u.rotation, scale: u.scale ?? 1 });
    }
  }
  if (pieces.length === 0) return;
  const holder = new Container();
  holder.label = 'floor-edge-units';
  placePieces(holder, pieces, 0xffffff, 0);
  parent.addChild(holder);
}
