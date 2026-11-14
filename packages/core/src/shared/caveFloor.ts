// A painted cave as real floors. With the Material brush's "Paint a real floor" on, a stroke
// lands as floor shapes rather than a paint-only patch, so the union, walls, rooms, doors,
// light, fog and the table see it like any floor. The floor texture is pinned to the
// material's fill. With Border on the shape carries the material as its edge marker
// (`edgeMaterial`): the cave owns its edge, so its rock (materialRenderer.ts) and its wall
// (`resolveWalls`, kind `cave`) follow its own outline even where it lies inside another
// floor and no union ring runs; with Border off it is a plain floor pinned to no stone.
// A 3.10 patch whose edge was a wall loads as the same floors (`wallPatchesToFloors`); the
// shape and load functions need no Clipper, so they run at load as well as in the tool.

import type { Polygon } from '../types/geometry';
import type { AnyChild, ShapeChild, ThresholdSegment } from './types';
import { DEFAULT_TEXTURE_SCALE } from './types';
import type { Layer } from '../store/types';
import { simplifyPath } from '../geometry/simplify';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { cutCorners, patchArea } from './materialPatch';
import { floorPieces } from './floorPieces';
import { nextAuthoredName } from './authoredName';
import { flattenRing } from './bezier';
import { applyShapeTransform } from './plateaus';

/** How closely a smoothed ring keeps to the painted one before it is rounded, in cells (the patch's rule). */
const SMOOTH_SIMPLIFY = 0.2;
/** Corner-cutting passes: each rounds every corner further (the patch's rule). */
const SMOOTH_PASSES = 3;
/** The rounded ring thinned again, so a cave ring carries a few hundred points rather than thousands. */
const SMOOTH_THIN = 0.04;

/** What a cave floor is pinned to. */
export interface CaveLook {
  /** The band set the floor's rock is laid with ('GG_Cave_Ink'). */
  material: string;
  /** The material's fill, a pack-scoped floor texture id; undefined when none is known. */
  fill: string | undefined;
  /** Off, the floor is pinned to no stone at all. */
  border: boolean;
  /** The floor's own opacity (the brush's Strength); absent = full. */
  opacity?: number;
  /** The floor's height, cells (the brush's Height); absent = 0. */
  height?: number;
}

/** Douglas-Peucker over a closed ring: its seam point is kept, so the ring stays closed. */
function simplifyRing(ring: Polygon, epsilon: number): Polygon {
  if (ring.length < 4) return ring;
  const open = simplifyPath([...ring, ring[0]].map(([x, y]) => ({ x, y })), epsilon);
  const out = open.slice(0, -1).map((p): [number, number] => [p.x, p.y]);
  return out.length >= 3 ? out : ring;
}

/** A ring smoothed as a patch is (simplified, corners cut), then thinned again. Winding is kept. */
export function smoothCaveRing(ring: Polygon): Polygon {
  let out = simplifyRing(ring, SMOOTH_SIMPLIFY);
  if (out.length < 3) return ring;
  for (let k = 0; k < SMOOTH_PASSES; k++) out = cutCorners(out);
  return simplifyRing(out, SMOOTH_THIN);
}

/**
 * Rings (outer rings and holes, wound opposite ways, as Clipper and a patch leave them) as
 * floor contours: one entry per outer ring, `[outer, ...holes]`, each ring smoothed first
 * with `smooth`.
 */
export function caveFloorContours(rings: readonly Polygon[], smooth: boolean): Polygon[][] {
  return floorPieces(smooth ? rings.map(smoothCaveRing) : [...rings]);
}

/** The edge marker a cave floor carries: the material with Border on, none without. */
function edgeOf(look: CaveLook): string | undefined {
  return look.border ? look.material : undefined;
}

/**
 * A floor shape for `contours`, pinned to the look. It pins no stone on the union's ring
 * (`wallTextureSetId: ''`): with Border on its rock and wall follow its own outline instead
 * (`edgeMaterial`, see `caveEdges`), so they are there even inside another floor.
 */
export function caveFloorShape(contours: Polygon[], look: CaveLook, id: string, name: string): ShapeChild {
  const shape: ShapeChild = {
    id,
    name,
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours,
    textureScale: DEFAULT_TEXTURE_SCALE,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    styleOverrides: { wallTextureSetId: '' },
  };
  if (look.fill) shape.textureId = look.fill;
  const edge = edgeOf(look);
  if (edge) shape.edgeMaterial = edge;
  if (look.opacity !== undefined) shape.opacity = look.opacity;
  if (look.height) shape.height = look.height;
  return shape;
}

/** Whether `shape` is a cave floor of `look` (same fill, edge marker, opacity and height), so a stroke merges with it. */
export function hasCaveLook(shape: ShapeChild, look: CaveLook): boolean {
  return (
    shape.textureId === look.fill &&
    shape.edgeMaterial === edgeOf(look) &&
    shape.styleOverrides?.wallTextureSetId === '' &&
    (shape.opacity ?? 1) === (look.opacity ?? 1) &&
    (shape.height || 0) === (look.height || 0)
  );
}

/* ── A cave's own edge ────────────────────────────────────── */

/** A layer's caves of one material: the outline rings of the union of its marked floors. */
export interface CaveEdge {
  material: string;
  /** Outer rings and holes, as the union leaves them. */
  rings: Polygon[];
}

/** A floor ring's edge this near a cave's outline lies on it. */
const ON_CAVE_EDGE = 0.02;
/** The id stem of the thin cut a cave's edge makes in the room faces. */
const CAVE_CUT_ID = 'cave-edge';

/** A shape's rings as its floor is drawn: flattened, with its transform baked in. */
export function drawnShapeRings(shape: ShapeChild): Polygon[] {
  return shape.contours.map((r, i) => {
    const flat = flattenRing(r, shape.tangents?.[i]);
    return shape.transform ? applyShapeTransform(flat, shape.transform) : flat;
  });
}

const edgeMemo = new Map<string, { children: unknown; out: CaveEdge[] }>();

/**
 * The caves on a layer whose rock and wall follow their own outline: per material, the
 * union of the visible floors marked with it (`edgeMaterial`). A lone floor's rings are
 * taken as they are; several are unioned (Clipper; without it they stay side by side).
 * Memoised on the layer's children.
 */
export function caveEdges(layer: { id: string; children: readonly AnyChild[] }): CaveEdge[] {
  const hit = edgeMemo.get(layer.id);
  if (hit && hit.children === layer.children) return hit.out;
  const byMaterial = new Map<string, ShapeChild[]>();
  for (const c of layer.children) {
    if (c.childType !== 'shape' || c.visible === false) continue;
    const shape = c as ShapeChild;
    // A ground piece's rock rim is paint: no wall runs along it and no room is cut by it.
    if (!shape.edgeMaterial || shape.ground) continue;
    byMaterial.set(shape.edgeMaterial, [...(byMaterial.get(shape.edgeMaterial) ?? []), shape]);
  }
  const out: CaveEdge[] = [];
  for (const [material, shapes] of byMaterial) {
    // Each floor's region is normalised (its holes cut, wound the one way) before the union:
    // a floor wound the other way round from its neighbour cancelled it where they overlapped
    // under the non-zero rule, leaving rock rings and stems through the middle of the cave.
    const rings =
      shapes.length === 1
        ? drawnShapeRings(shapes[0]).filter((r) => r.length >= 3)
        : clipper2Engine.union(
            shapes.flatMap((s) => {
              const [outer, ...holes] = drawnShapeRings(s);
              return !outer ? [] : clipper2Engine.difference([outer], holes);
            }),
            [],
          );
    if (rings.length > 0) out.push({ material, rings });
  }
  edgeMemo.set(layer.id, { children: layer.children, out });
  return out;
}

/** The id of a cave's wall: `cave:{material}:{ring}`, rebuilt on every resolve. */
export function caveWallId(material: string, ring: number): string {
  return `cave:${material}:${ring}`;
}

function nearSegment([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Whether `p` lies on any cave's outline (within a hair), so a floor ring's edge there is the cave's wall already. */
export function onCaveEdge(p: [number, number], edges: readonly CaveEdge[]): boolean {
  for (const { rings } of edges) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        if (nearSegment(p, ring[i], ring[(i + 1) % ring.length]) < ON_CAVE_EDGE) return true;
      }
    }
  }
  return false;
}

/* ── Openings in a cave's rock ────────────────────────────── */

/**
 * How far a cave's rock reaches from its edge, cells. An erase this near the edge is on the
 * rock, and an edge this near an opening region is open.
 */
export const CAVE_ROCK_REACH = 0.6;
/** Paint closes an opening this much past the rock's reach, so no edge of the paint is left on the rim of what remains. */
const CLOSE_MARGIN = 0.05;
/** Opening regions smaller than this, in square cells, are gone. */
const MIN_OPENING = 0.02;

/**
 * Whether the cave ring edge `a` → `b` is open: its midpoint lies in one of the layer's
 * opening regions (`DungeonLayer.caveOpenings`: the erase strokes that crossed the rock),
 * or within the rock's reach of one. An open edge carries no rock and is no wall, so the
 * cave is open to the ground outside there.
 */
export function caveEdgeOpen(a: [number, number], b: [number, number], openings: readonly Polygon[] | undefined): boolean {
  if (!openings || openings.length === 0) return false;
  const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let inside = false;
  for (const ring of openings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (nearSegment(m, ring[j], ring[i]) < CAVE_ROCK_REACH) return true;
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > m[1] !== yj > m[1] && m[0] < ((xj - xi) * (m[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * The stretches of a cave ring that stand as wall: the ring closed (its first point
 * repeated) while no edge of it is open, else one open line per run of edges between
 * openings. None for a ring open all round.
 */
export function caveWallRuns(ring: Polygon, openings: readonly Polygon[] | undefined): Polygon[] {
  const n = ring.length;
  const open = ring.map((a, i) => caveEdgeOpen(a, ring[(i + 1) % n], openings));
  if (!open.includes(true)) return [[...ring, ring[0]]];
  const runs: Polygon[] = [];
  // Read from just past an opening, so no run is split across the ring's seam.
  const start = open.indexOf(true) + 1;
  let run: Polygon | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (open[i]) {
      if (run) runs.push(run);
      run = null;
      continue;
    }
    run ??= [ring[i]];
    run.push(ring[(i + 1) % n]);
  }
  if (run) runs.push(run);
  return runs;
}

/** An open edge is handed to the rock's walk in gaps no longer than this, so a long edge's gap reaches no rock but its own. */
const OPEN_GAP = 0.5;

/**
 * A cave's open edges as gaps in its rock, in the shape a door's gap takes (a point on the
 * edge and the width it clears): the band walk stops its rock at them and closes each run on
 * its own tip, as it does either side of a door.
 */
export function caveOpeningGaps(cave: CaveEdge, openings: readonly Polygon[] | undefined): { wallId: string; position: [number, number]; width: number }[] {
  if (!openings || openings.length === 0) return [];
  const gaps: { wallId: string; position: [number, number]; width: number }[] = [];
  cave.rings.forEach((ring, r) => {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      if (!caveEdgeOpen(a, b, openings)) return;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / OPEN_GAP));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        gaps.push({ wallId: caveWallId(cave.material, r), position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], width: len / n });
      }
    });
  });
  return gaps;
}

/**
 * The layer's opening regions once an erase stroke over `area` has crossed a cave's rock, or
 * null when the stroke opens nothing: it lies wholly inside the cave (a hole, rocked round
 * as ever) or nowhere near one. A stroke that only brushes the rock from outside, cutting no
 * floor, counts: the rock rides outside the floor's edge.
 */
export function openCaveAt(layer: { id: string; children: readonly AnyChild[]; caveOpenings?: Polygon[] }, area: Polygon[]): Polygon[] | null {
  const caves = caveEdges(layer).flatMap((c) => c.rings);
  if (caves.length === 0 || area.length === 0) return null;
  if (patchArea(clipper2Engine.difference(area, caves)) < 1e-6) return null;
  if (patchArea(clipper2Engine.intersection(clipper2Engine.inflate(area, CAVE_ROCK_REACH), caves)) < 1e-6) return null;
  return clipper2Engine.union([...(layer.caveOpenings ?? []), ...area], []);
}

/** Whether a stroke over `area` is on a cave: on its floor, or within its rock's reach of it. */
export function strokeOnCave(layer: { id: string; children: readonly AnyChild[] }, area: Polygon[]): boolean {
  const caves = caveEdges(layer).flatMap((c) => c.rings);
  if (caves.length === 0 || area.length === 0) return false;
  return patchArea(clipper2Engine.intersection(clipper2Engine.inflate(area, CAVE_ROCK_REACH), caves)) >= 1e-6;
}

/**
 * The opening regions left once cave floor is painted over `area`: the paint, and the rock's
 * reach round it, come out of them, so rock returns wherever the outline now runs through
 * painted ground; regions painted away whole go. `openings` itself when the paint touches none.
 */
export function closeCaveOpenings(openings: Polygon[] | undefined, area: Polygon[]): Polygon[] | undefined {
  if (!openings || openings.length === 0 || area.length === 0) return openings;
  const painted = clipper2Engine.inflate(area, CAVE_ROCK_REACH + CLOSE_MARGIN);
  if (patchArea(clipper2Engine.intersection(openings, painted)) < 1e-6) return openings;
  const left = clipper2Engine.difference(openings, painted);
  return patchArea(left) < MIN_OPENING ? undefined : left;
}

/** Each cave ring as a thin cutter (a threshold's width), so the room faces split along a cave's edge. */
export function caveCutters(layer: { id: string; children: readonly AnyChild[] }): ThresholdSegment[] {
  return caveEdges(layer).flatMap(({ material, rings }) =>
    rings.map((ring, i) => ({ id: `${CAVE_CUT_ID}:${caveWallId(material, i)}`, points: [...ring, ring[0]] })),
  );
}

/** Floors for a whole patch's rings, named on from `children` (`Cave N`). */
export function caveFloors(
  rings: readonly Polygon[],
  smooth: boolean,
  look: CaveLook,
  children: readonly Pick<AnyChild, 'name'>[],
  newId: () => string,
): ShapeChild[] {
  const named: Pick<AnyChild, 'name'>[] = [...children];
  return caveFloorContours(rings, smooth).map((contours) => {
    const shape = caveFloorShape(contours, look, newId(), nextAuthoredName(named, 'Cave'));
    named.push(shape);
    return shape;
  });
}

interface LoadedPatch {
  id: string;
  material: string;
  rings: Polygon[];
  smooth: boolean;
  border: boolean;
  wall?: boolean;
}

/**
 * A 3.10 map's patches whose edge was a wall, as the floors the brush now paints: each such
 * patch becomes floor shapes (appended to its layer's children) and is dropped; every other
 * patch stays. `fillOf` names a material's fill from the pack catalog; a patch whose fill it
 * cannot name yet is left as it is, so a map opened before the packs land converts once they
 * do (the caller runs this again then). Hands back `layers` itself when nothing changed.
 */
export function wallPatchesToFloors<L extends Layer>(
  layers: L[],
  fillOf: (material: string) => string | undefined,
  newId: () => string = () => crypto.randomUUID(),
): L[] {
  let changed = false;
  const out = layers.map((layer) => {
    if (layer.type !== 'dungeon') return layer;
    const patches = (layer.materials ?? []) as LoadedPatch[];
    // A cave painted before the marker pinned the band on the union ring instead: the same
    // floor, moved onto the marker so it keeps its rock on top of another floor too.
    const bandPin = (c: AnyChild): string | null => {
      if (c.childType !== 'shape' || c.edgeMaterial) return null;
      const pin = c.styleOverrides?.wallTextureSetId;
      return typeof pin === 'string' && pin !== '' && !!c.textureId && fillOf(pin) === c.textureId ? pin : null;
    };
    if (!patches.some((p) => p.wall === true && fillOf(p.material)) && !layer.children.some((c) => bandPin(c) !== null)) return layer;
    changed = true;
    const children: AnyChild[] = layer.children.map((c): AnyChild => {
      const pin = bandPin(c);
      if (pin === null || c.childType !== 'shape') return c;
      return { ...c, edgeMaterial: pin, styleOverrides: { ...c.styleOverrides, wallTextureSetId: '' } };
    });
    const kept: LoadedPatch[] = [];
    for (const p of patches) {
      const fill = p.wall === true ? fillOf(p.material) : undefined;
      if (!fill) {
        kept.push(p);
        continue;
      }
      children.push(...caveFloors(p.rings, p.smooth, { material: p.material, fill, border: p.border }, children, newId));
    }
    return { ...layer, children, materials: kept.length > 0 ? kept : undefined } as L;
  });
  return changed ? out : layers;
}
