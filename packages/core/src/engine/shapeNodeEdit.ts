// Vertex editing for floor outlines.
//
// Handles are drawn on the MERGED outline, not on each source shape's own ring:
// once a corridor rectangle unions into a hall, the outline the DM sees is the
// only one worth grabbing, and the union's outer corners have no source vertex
// behind them at all.
//
// The price is that editing such an outline has to collapse the shapes that
// formed it into one polygon — there is no way to push a union-only corner back
// into two overlapping rectangles. That collapse happens on the first *edit*,
// never on merely entering the mode, and rides in the same undo entry as the
// edit that caused it.

import type { Point, Polygon } from '../types/geometry';
import type { DungeonLayer, ShapeChild, AnyChild } from '../store/types';
import { useStore } from '../store/store';
import { isLayerEffectivelyVisible } from '../store/selectors';
import { undoManager } from '../store/undoManager';
import {
  AddChildCommand,
  RemoveChildCommand,
  UpdateChildCommand,
  CompositeCommand,
} from '../store/commands';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { pointInPolygon } from './hitTest';
import { notify } from '../shared/notify';
import {
  edgeControls,
  edgeIsCurved,
  flattenRing,
  projectToCubic,
  ringHasCurves,
  splitCubic,
  type RingTangents,
  type Vec2,
  type VertexTangents,
} from '../shared/bezier';

/** Signed area; positive and negative distinguish outer rings from holes. */
function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return a / 2;
}

function ringOf(shape: ShapeChild): Polygon {
  const t = shape.transform;
  if (!t) return shape.contours[0] ?? [];
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  return (shape.contours[0] ?? []).map(([px, py]): [number, number] => {
    const sx = px * t.scale[0];
    const sy = py * t.scale[1];
    return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
  });
}

/**
 * The shape's outer-ring tangents in the same space as `ringOf` — the optional
 * baked-in transform moves handle points exactly like ring points, or a
 * transformed shape's curves would bend toward where it used to stand.
 */
function ringTangentsOf(shape: ShapeChild): RingTangents | undefined {
  const raw = shape.tangents?.[0];
  if (!ringHasCurves(raw)) return undefined;
  const t = shape.transform;
  if (!t) return raw;
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  const map = ([px, py]: Vec2): Vec2 => {
    const sx = px * t.scale[0];
    const sy = py * t.scale[1];
    return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
  };
  return (raw ?? []).map((vt) =>
    vt
      ? {
          ...(vt.tin ? { tin: map(vt.tin) } : {}),
          ...(vt.tout ? { tout: map(vt.tout) } : {}),
        }
      : vt,
  );
}

/** The shape's outer ring as downstream geometry sees it: baked, then flattened. */
function flatRingOf(shape: ShapeChild): Polygon {
  return flattenRing(ringOf(shape), ringTangentsOf(shape));
}

function centroid(poly: Polygon): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function ringBounds(poly: Polygon): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export interface OutlineTarget {
  layer: DungeonLayer;
  /** The outer ring being edited, in world units. */
  outline: Polygon;
  /** Hole rings that sit inside it and must survive a collapse. */
  holes: Polygon[];
  /**
   * Shapes that union into this outline. One means no collapse is needed.
   *
   * A function, not a field: working it out costs one Clipper2 boolean per
   * shape on the layer, and the overlay resolves a target every frame purely to
   * read `outline`. Eagerly computed, that was dozens of WASM ops at 60 Hz for
   * a static overlay. Only the write paths call it.
   */
  contributors: () => ShapeChild[];
  /**
   * Index into `holes` when the ring being edited is one of them rather than
   * the outer boundary. A hole's stones are wall the DM can see and grab just
   * like any other, so they have to be draggable — and dragging one edits that
   * hole while the outer ring stays put.
   */
  hole?: number;
  /**
   * Curve basis. Present exactly when the outline is one shape's authored ring
   * (sole contributor): `outline` is then the authored anchors — not the merged
   * flattened polygon — and this list carries their tangents, empty for a ring
   * with no curves yet. Absent means the outline came out of a union: edits on
   * it collapse to a straight polygon first, and curves can be authored on the
   * result.
   */
  tangents?: RingTangents;
}

/** The ring `target` actually edits: its outer boundary, or one of its holes. */
export function editedRing(target: OutlineTarget): Polygon {
  return target.hole === undefined ? target.outline : target.holes[target.hole];
}

/** The full contour list for a shape whose edited ring became `next`. */
function contoursWith(
  target: Pick<OutlineTarget, 'outline' | 'holes' | 'hole'>,
  next: Polygon,
): Polygon[] {
  return target.hole === undefined
    ? [next, ...target.holes]
    : [target.outline, ...target.holes.map((h, i) => (i === target.hole ? next : h))];
}

/**
 * The merged outline the given shape belongs to, plus everything needed to
 * write an edit back.
 */
export function resolveOutline(shapeId: string): OutlineTarget | null {
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.children.some((c) => c.id === shapeId),
  );
  if (!layer) return null;

  const shape = layer.children.find(
    (c): c is ShapeChild => c.id === shapeId && c.childType === 'shape',
  );
  if (!shape) return null;

  const rings = layer.mergedFloor ?? [];
  const outers = rings.filter((r) => r.length >= 3 && signedArea(r) >= 0);

  // The outer ring this shape sits in. Its own centroid can fall in a hole or,
  // for an L-shape, outside the ring entirely, so fall back to any vertex.
  const own = ringOf(shape);
  if (own.length < 3) return null;
  const probe = centroid(own);
  const outline =
    outers.find((r) => pointInPolygon(probe, r)) ??
    outers.find((r) => own.some((p) => pointInPolygon(p, r))) ??
    null;
  if (!outline) return null;
  const target = targetFor(layer, outline);

  // Sole contributor: hand back the authored ring so its anchors — and any
  // curves on them — are what the editor shows and writes. The overlay resolves
  // every frame, so soleness is cached on the children array's identity; immer
  // replaces the array whenever any child changes.
  if (isSoleContributor(layer, shape.id, target)) {
    return { ...target, outline: ringOf(shape), tangents: ringTangentsOf(shape) ?? [] };
  }
  return target;
}

const soleCache = new WeakMap<object, Map<string, boolean>>();

function isSoleContributor(layer: DungeonLayer, shapeId: string, target: OutlineTarget): boolean {
  let byShape = soleCache.get(layer.children);
  if (!byShape) {
    byShape = new Map();
    soleCache.set(layer.children, byShape);
  }
  const hit = byShape.get(shapeId);
  if (hit !== undefined) return hit;
  const sole = target.contributors().length === 1;
  byShape.set(shapeId, sole);
  return sole;
}

/**
 * The same target, addressed by index into `mergedFloor` rather than by shape.
 *
 * A wall derived from a floor ring is identified that way — `floor:<index>` —
 * and has no shape id of its own to resolve from, so dragging one of its stones
 * needs this door into the outline editor.
 *
 * Holes are not editable this way: a hole ring is the inside of an erase, and
 * `commitOutline` writes the outer ring plus its holes, so there is nothing
 * sensible to hand it.
 */
export function resolveRingOutline(layer: DungeonLayer, ring: number): OutlineTarget | null {
  const poly = layer.mergedFloor?.[ring];
  if (!poly || poly.length < 3) return null;
  if (signedArea(poly) >= 0) return targetFor(layer, poly);

  // A hole. Its edit is written against the outer ring it sits in, so find that
  // first and then say which of its holes this is.
  const probe = centroid(poly);
  const outer = (layer.mergedFloor ?? []).find(
    (r) => r !== poly && r.length >= 3 && signedArea(r) >= 0 && pointInPolygon(probe, r),
  );
  if (!outer) return null;
  const target = targetFor(layer, outer);
  const hole = target.holes.indexOf(poly);
  return hole < 0 ? null : { ...target, hole };
}

function targetFor(layer: DungeonLayer, outline: Polygon): OutlineTarget {
  const holes = (layer.mergedFloor ?? []).filter(
    (r) => r.length >= 3 && signedArea(r) < 0 && pointInPolygon(centroid(r), outline),
  );

  const bounds = ringBounds(outline);
  const contributors = () =>
    layer.children.filter((c): c is ShapeChild => {
      if (c.childType !== 'shape' || !c.visible) return false;
      // Curves contribute their flattened extent, so overlap is tested on the
      // same ring the union saw — the authored anchors of a bowed edge can sit
      // entirely inside a neighbour they do not actually touch.
      const r = flatRingOf(c);
      if (r.length < 3) return false;
      // Disjoint boxes cannot overlap; skip the WASM round trip for them.
      if (!boundsOverlap(bounds, ringBounds(r))) return false;
      const hit = clipper2Engine.intersection([r], [outline]) as Polygon[];
      return hit.length > 0 && hit.some((p) => p.length >= 3);
    });

  return { layer, outline, holes, contributors };
}

/** Grid snap, matching what the drawing tools apply. */
function snap(v: number): number {
  const grid = useStore.getState().grid;
  if (!grid.snapEnabled) return v;
  const step = 1 / (grid.snapDivision || 1);
  return Math.round(v / step) * step;
}

export type OutlineEdit =
  | { kind: 'move'; index: number; x: number; y: number }
  | { kind: 'moveEdge'; index: number; dx: number; dy: number }
  | { kind: 'insert'; index: number; x: number; y: number }
  | { kind: 'delete'; index: number }
  | { kind: 'toggleSmooth'; index: number };

/** The outline that results from applying `edit`, or null if it is not legal. */
export function editedOutline(outline: Polygon, edit: OutlineEdit): Polygon | null {
  const pts = outline.map(([x, y]): [number, number] => [x, y]);
  switch (edit.kind) {
    case 'move':
      if (edit.index < 0 || edit.index >= pts.length) return null;
      pts[edit.index] = [snap(edit.x), snap(edit.y)];
      return pts;
    case 'moveEdge': {
      // The edge from index to index+1: both ends move together, so the run
      // stays parallel to where it started.
      const a = edit.index % pts.length;
      const b = (edit.index + 1) % pts.length;
      pts[a] = [snap(pts[a][0] + edit.dx), snap(pts[a][1] + edit.dy)];
      pts[b] = [snap(pts[b][0] + edit.dx), snap(pts[b][1] + edit.dy)];
      return pts;
    }
    case 'insert':
      pts.splice(edit.index + 1, 0, [snap(edit.x), snap(edit.y)]);
      return pts;
    case 'delete':
      // A ring needs three corners to still be a room.
      if (pts.length <= 3) return null;
      pts.splice(edit.index, 1);
      return pts;
    case 'toggleSmooth':
      // Meaningless without tangents; the curved variant below owns it.
      return null;
  }
}

// ─── Curved edits ───────────────────────────────────────────────────────────

/** A ring plus its per-vertex tangents, always index-aligned. */
export interface CurvedRing {
  ring: Polygon;
  tangents: RingTangents;
}

function padTangents(tangents: RingTangents | undefined, n: number): RingTangents {
  return Array.from({ length: n }, (_, i) => tangents?.[i] ?? null);
}

function shifted(
  vt: VertexTangents | null,
  dx: number,
  dy: number,
): VertexTangents | null {
  if (!vt || (!vt.tin && !vt.tout)) return vt;
  return {
    ...(vt.tin ? { tin: [vt.tin[0] + dx, vt.tin[1] + dy] as Vec2 } : {}),
    ...(vt.tout ? { tout: [vt.tout[0] + dx, vt.tout[1] + dy] as Vec2 } : {}),
  };
}

/** A split control that landed on its own anchor is no curve at all. */
function cleanControl(c: Vec2, anchor: Vec2): Vec2 | undefined {
  return Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) < 1e-6 ? undefined : c;
}

function normalizeVertex(vt: VertexTangents): VertexTangents | null {
  return vt.tin || vt.tout ? vt : null;
}

/**
 * `editedOutline`, curve-aware: tangents ride every splice and every move, so
 * they never drift out of alignment with their anchors. Same null-on-illegal
 * contract.
 */
export function editedCurvedRing(
  ring: Polygon,
  tangents: RingTangents | undefined,
  edit: OutlineEdit,
): CurvedRing | null {
  const pts = ring.map(([x, y]): [number, number] => [x, y]);
  const tans = padTangents(tangents, pts.length);
  const n = pts.length;

  switch (edit.kind) {
    case 'move': {
      if (edit.index < 0 || edit.index >= n) return null;
      const [ox, oy] = pts[edit.index];
      const next: [number, number] = [snap(edit.x), snap(edit.y)];
      pts[edit.index] = next;
      // Handles travel with their anchor by the anchor's own (snapped) delta,
      // so the curve keeps its shape instead of bending toward the old spot.
      tans[edit.index] = shifted(tans[edit.index], next[0] - ox, next[1] - oy);
      return { ring: pts, tangents: tans };
    }
    case 'moveEdge': {
      const a = edit.index % n;
      const b = (edit.index + 1) % n;
      for (const i of [a, b]) {
        const [ox, oy] = pts[i];
        pts[i] = [snap(ox + edit.dx), snap(oy + edit.dy)];
        tans[i] = shifted(tans[i], pts[i][0] - ox, pts[i][1] - oy);
      }
      return { ring: pts, tangents: tans };
    }
    case 'insert': {
      const i = edit.index % n;
      const j = (i + 1) % n;
      if (!edgeIsCurved(tans[i], tans[j])) {
        pts.splice(i + 1, 0, [snap(edit.x), snap(edit.y)]);
        tans.splice(i + 1, 0, null);
        return { ring: pts, tangents: tans };
      }
      // Splitting the cubic keeps the drawn curve identical: the new anchor
      // lands ON it, unsnapped — the grid would kink the very line the DM is
      // trying to refine.
      const [c1, c2] = edgeControls(pts[i], pts[j], tans[i], tans[j]);
      const t = projectToCubic(pts[i], c1, c2, pts[j], [edit.x, edit.y]);
      if (t <= 0.001 || t >= 0.999) return null;
      const { left, right } = splitCubic(pts[i], c1, c2, pts[j], t);
      tans[i] = normalizeVertex({ ...tans[i], tout: cleanControl(left[1], left[0]) });
      tans[j] = normalizeVertex({ ...tans[j], tin: cleanControl(right[2], right[3]) });
      const s = left[3];
      pts.splice(i + 1, 0, [s[0], s[1]]);
      tans.splice(
        i + 1,
        0,
        normalizeVertex({
          tin: cleanControl(left[2], s),
          tout: cleanControl(right[1], s),
        }),
      );
      return { ring: pts, tangents: tans };
    }
    case 'delete': {
      if (n <= 3) return null;
      pts.splice(edit.index, 1);
      tans.splice(edit.index, 1);
      return { ring: pts, tangents: tans };
    }
    case 'toggleSmooth': {
      const i = edit.index;
      if (i < 0 || i >= n) return null;
      const vt = tans[i];
      if (vt && (vt.tin || vt.tout)) {
        tans[i] = null;
        return { ring: pts, tangents: tans };
      }
      // Auto-smooth: handles along the prev→next chord, a third of each
      // adjacent edge long — the standard pen-tool smoothing.
      const p = pts[i];
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      const ux = dx / len;
      const uy = dy / len;
      const lin = Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 3;
      const lout = Math.hypot(next[0] - p[0], next[1] - p[1]) / 3;
      tans[i] = {
        tin: [p[0] - ux * lin, p[1] - uy * lin],
        tout: [p[0] + ux * lout, p[1] + uy * lout],
      };
      return { ring: pts, tangents: tans };
    }
  }
}

function makePolygonShape(
  name: string,
  contours: Polygon[],
  from: ShapeChild,
  tangents?: RingTangents,
): ShapeChild {
  return {
    ...from,
    id: crypto.randomUUID(),
    name,
    childType: 'shape',
    shapeType: 'polygon',
    contours: contours.map((r) => r.map(([x, y]): [number, number] => [x, y])),
    // Explicit even when absent: `from`'s own tangents describe `from`'s ring,
    // not these contours, and the spread above would carry them across.
    tangents: tangents && ringHasCurves(tangents) ? [tangents] : undefined,
    // Baked into the rings above; leaving it would apply the offset twice.
    transform: undefined,
  };
}

/**
 * Write an edited outline back, collapsing contributors if there is more than
 * one. Returns the id of the shape that now owns the outline, so edit mode can
 * follow it across the collapse.
 */
export function commitOutline(
  target: OutlineTarget,
  next: Polygon,
  label: string,
  nextTangents?: RingTangents,
): string | null {
  const { layer } = target;
  const contours = contoursWith(target, next);
  const contributors = target.contributors();
  if (contributors.length === 0) return null;

  // Only an outer-ring edit on the authored basis carries curves forward; a
  // stone drag or a union collapse rewrites the ring as flattened points, and
  // stale tangents on those would bend the wrong edges entirely.
  const ringT =
    target.hole === undefined && nextTangents && ringHasCurves(nextTangents)
      ? nextTangents
      : undefined;
  if (
    target.tangents === undefined &&
    contributors.some((c) => c.tangents?.some((rt) => ringHasCurves(rt)))
  ) {
    notify.info('Curved edges were flattened into straight segments');
  }

  if (contributors.length === 1) {
    const only = contributors[0];
    undoManager.execute(
      new UpdateChildCommand(
        label,
        layer.id,
        only.id,
        {
          contours: only.contours,
          tangents: only.tangents,
          transform: only.transform,
        } as Partial<AnyChild>,
        {
          contours,
          tangents: ringT ? [ringT] : undefined,
          transform: undefined,
        } as Partial<AnyChild>,
      ),
    );
    return only.id;
  }

  const merged = makePolygonShape(contributors[0].name, contours, contributors[0], ringT);
  undoManager.execute(
    new CompositeCommand(label, [
      ...contributors.map((c) => new RemoveChildCommand(label, layer.id, c.id)),
      new AddChildCommand(label, layer.id, merged),
    ]),
  );
  return merged.id;
}

/**
 * Toggle vertex editing for whatever floor is under `world`.
 * Returns true when it took the click.
 */
export function toggleShapeNodeEditAt(world: Point): boolean {
  const state = useStore.getState();
  if (state.tools.shapeNodeEditId) {
    state.setShapeNodeEdit(null);
    return true;
  }
  const layer = state.layers.find(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' && !l.locked && l.id === state.ui.activeLayerId && isLayerEffectivelyVisible(state, l),
  );
  if (!layer) return false;
  // Topmost first, matching how selection picks.
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const c = layer.children[i];
    if (c.childType !== 'shape' || !c.visible) continue;
    if (pointInPolygon([world.x, world.y], ringOf(c))) {
      state.setShapeNodeEdit(c.id);
      return true;
    }
  }
  return false;
}

export function exitShapeNodeEdit(): void {
  useStore.getState().setShapeNodeEdit(null);
}

// ─── Dragging ───────────────────────────────────────────────────────────────
//
// A drag previews live — the floor and its walls follow the cursor — which for
// a multi-shape outline means collapsing before the gesture is finished. The
// session therefore keeps the layer's children as they were, rewinds to them on
// release, and replays the whole thing through one command. Without the rewind
// the collapse and every previewed frame would each land on the undo stack.

interface DragSession {
  layerId: string;
  beforeChildren: AnyChild[];
  /**
   * The shape edit mode pointed at before any collapse. The rewind puts the
   * original children back, at which point the collapsed shape's id refers to
   * nothing — resolving against it silently dropped the whole edit.
   *
   * Null for a stone drag on a floor ring, which is addressed by `ringIndex`
   * and never puts the layer into shape-node-edit mode at all.
   */
  originalShapeId: string | null;
  /** Ring the drag came in through, for a stone drag. */
  ringIndex: number | null;
  /** The edited ring at the moment the drag began; every frame re-derives it. */
  base: Polygon;
  /** `base`'s tangents, padded to its length. All null on a flattened basis. */
  baseTangents: RingTangents;
  /** True when `base` is an authored ring whose curves survive the commit. */
  authored: boolean;
  /** The rest of the shape, so a preview frame can write whole contours. */
  rings: Pick<OutlineTarget, 'outline' | 'holes' | 'hole'>;
  kind: 'vertex' | 'edge' | 'group' | 'tangents' | 'bow';
  index: number;
  /** Vertices a group drag displaces together. */
  indices: number[];
  /** Side of the anchor a tangent drag grabbed. */
  which: 'in' | 'out' | null;
  /** Keep the tangent pair mirrored; Alt mid-drag breaks it for the gesture. */
  mirror: boolean;
  /** Shape carrying the outline during the preview. */
  ownerId: string;
  collapsed: boolean;
  latest: CurvedRing | null;
}

let drag: DragSession | null = null;

function setChildren(layerId: string, children: AnyChild[]): void {
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === layerId);
    if (l && l.type === 'dungeon') l.children = structuredClone(children);
  });
}

export function isDraggingOutline(): boolean {
  return drag !== null;
}

/**
 * Start dragging a vertex, an edge, a tangent handle, or a bow gesture.
 * Returns false if there is nothing to drag.
 */
export function beginOutlineDrag(
  kind: 'vertex' | 'edge' | 'tangents' | 'bow',
  index: number,
  opts?: { which?: 'in' | 'out'; forceMirror?: boolean },
): boolean {
  const shapeId = useStore.getState().tools.shapeNodeEditId;
  if (!shapeId) return false;
  const target = resolveOutline(shapeId);
  if (!target) return false;

  // A tangent pair stays mirrored while it IS a mirror — matching what the DM
  // sees — and when the gesture is creating one from scratch (Alt-drag out of
  // an anchor). A pair already broken stays broken.
  let mirror = opts?.forceMirror ?? false;
  if (kind === 'tangents' && !mirror) {
    const vt = target.tangents?.[index];
    if (!vt || (!vt.tin && !vt.tout)) mirror = true;
    else if (vt.tin && vt.tout) {
      const p = target.outline[index];
      mirror =
        Math.hypot(vt.tin[0] + vt.tout[0] - 2 * p[0], vt.tin[1] + vt.tout[1] - 2 * p[1]) < 1e-6;
    }
  }

  return startDrag(target, {
    shapeId,
    ringIndex: null,
    base: target.outline,
    kind,
    index,
    indices: [],
    which: opts?.which ?? null,
    mirror,
  });
}

/**
 * Start a drag that displaces a set of outline vertices together.
 *
 * `base` is the outline the caller wants edited, which for a stone drag has
 * anchor vertices in it that `target.outline` does not — see `planRingDrag`.
 * Materialising them costs nothing until the drag actually moves something,
 * because a gesture that ends where it began commits no outline at all.
 */
export function beginGroupOutlineDrag(
  target: OutlineTarget,
  base: Polygon,
  indices: number[],
  ringIndex: number,
): boolean {
  if (indices.length === 0) return false;
  return startDrag(target, {
    shapeId: null,
    ringIndex,
    base,
    kind: 'group',
    index: indices[0],
    indices,
    which: null,
    mirror: false,
  });
}

function startDrag(
  target: OutlineTarget,
  session: Pick<DragSession, 'ringIndex' | 'kind' | 'index' | 'indices' | 'which' | 'mirror'> & {
    shapeId: string | null;
    base: Polygon;
  },
): boolean {
  const beforeChildren = structuredClone(target.layer.children) as AnyChild[];
  const contributors = target.contributors();
  let ownerId = contributors[0]?.id;
  if (!ownerId) return false;
  let collapsed = false;

  if (contributors.length > 1) {
    // Collapse up front so the preview has one shape to write to. Undone on
    // release, then replayed as part of the single command.
    const merged = makePolygonShape(
      contributors[0].name,
      [target.outline, ...target.holes],
      contributors[0],
    );
    const keep = target.layer.children.filter(
      (c) => !contributors.some((s) => s.id === c.id),
    );
    setChildren(target.layer.id, [...keep, merged]);
    ownerId = merged.id;
    collapsed = true;
    if (session.shapeId) useStore.getState().setShapeNodeEdit(merged.id);
  }

  drag = {
    layerId: target.layer.id,
    beforeChildren,
    originalShapeId: session.shapeId,
    ringIndex: session.ringIndex,
    base: session.base.map(([x, y]): [number, number] => [x, y]),
    // A group drag's base has anchor vertices the authored ring never had, so
    // its tangent slots are all null by construction (resolveRingOutline never
    // hands out the authored basis).
    baseTangents: padTangents(target.tangents, session.base.length),
    authored: target.tangents !== undefined,
    rings: { outline: target.outline, holes: target.holes, hole: target.hole },
    kind: session.kind,
    index: session.index,
    indices: session.indices,
    which: session.which,
    mirror: session.mirror,
    ownerId,
    collapsed,
    latest: null,
  };
  return true;
}

/**
 * Preview the drag.
 *
 * @param world Cursor position, for a vertex drag.
 * @param delta Offset from where the drag started, for an edge drag.
 */
export function updateOutlineDrag(
  world: Point,
  delta: Point,
  opts?: { alt?: boolean },
): void {
  if (!drag) return;
  if (opts?.alt && drag.kind === 'tangents') drag.mirror = false;

  let next: CurvedRing | null;
  switch (drag.kind) {
    case 'group': {
      // Unsnapped on purpose: the anchors sit wherever the stones happened to
      // stand, so snapping them to the grid would shear the bulge sideways.
      const moved = new Set(drag.indices);
      next = {
        ring: drag.base.map(([x, y], i): [number, number] =>
          moved.has(i) ? [x + delta.x, y + delta.y] : [x, y],
        ),
        tangents: drag.baseTangents,
      };
      break;
    }
    case 'vertex':
      next = editedCurvedRing(drag.base, drag.baseTangents, {
        kind: 'move',
        index: drag.index,
        x: world.x,
        y: world.y,
      });
      break;
    case 'edge':
      next = editedCurvedRing(drag.base, drag.baseTangents, {
        kind: 'moveEdge',
        index: drag.index,
        dx: delta.x,
        dy: delta.y,
      });
      break;
    case 'tangents': {
      // Handles are freeform: snapping them to the grid would quantise the
      // curve the DM is shaping by eye.
      const i = drag.index;
      const p = drag.base[i];
      const grabbed: Vec2 = [world.x, world.y];
      const vt: VertexTangents = { ...drag.baseTangents[i] };
      if (drag.which === 'in') vt.tin = grabbed;
      else vt.tout = grabbed;
      if (drag.mirror) {
        const mirrored: Vec2 = [2 * p[0] - grabbed[0], 2 * p[1] - grabbed[1]];
        if (drag.which === 'in') vt.tout = mirrored;
        else vt.tin = mirrored;
      }
      const tans = [...drag.baseTangents];
      tans[i] = normalizeVertex(vt);
      next = { ring: drag.base, tangents: tans };
      break;
    }
    case 'bow': {
      // Displacing both controls by 4/3·delta moves the curve's midpoint by
      // exactly delta, so a straight edge's belly tracks the cursor 1:1.
      const i = drag.index;
      const j = (i + 1) % drag.base.length;
      const a = drag.base[i];
      const b = drag.base[j];
      const cx = (delta.x * 4) / 3;
      const cy = (delta.y * 4) / 3;
      const baseOut = drag.baseTangents[i]?.tout ?? [
        a[0] + (b[0] - a[0]) / 3,
        a[1] + (b[1] - a[1]) / 3,
      ];
      const baseIn = drag.baseTangents[j]?.tin ?? [
        b[0] - (b[0] - a[0]) / 3,
        b[1] - (b[1] - a[1]) / 3,
      ];
      const tans = [...drag.baseTangents];
      tans[i] = normalizeVertex({
        ...tans[i],
        tout: [baseOut[0] + cx, baseOut[1] + cy],
      });
      tans[j] = normalizeVertex({
        ...tans[j],
        tin: [baseIn[0] + cx, baseIn[1] + cy],
      });
      next = { ring: drag.base, tangents: tans };
      break;
    }
  }
  if (!next) return;
  drag.latest = next;
  useStore.getState().updateChild(drag.layerId, drag.ownerId, {
    contours: contoursWith(drag.rings, next.ring),
    // An unauthored basis (union collapse, stone drag) writes flattened
    // points; the owner's old tangents describe a ring that no longer exists
    // and must not survive into the preview.
    tangents:
      drag.rings.hole === undefined && ringHasCurves(next.tangents)
        ? [next.tangents]
        : undefined,
  } as Partial<AnyChild>);
}

/** Rewind the preview and, if anything actually moved, replay it as one command. */
export function endOutlineDrag(): void {
  const session = drag;
  drag = null;
  if (!session) return;

  const final = session.latest;
  setChildren(session.layerId, session.beforeChildren);
  // Always back to the pre-collapse shape: the merged id is gone now.
  if (session.originalShapeId) useStore.getState().setShapeNodeEdit(session.originalShapeId);

  if (
    !final ||
    (samePolygon(final.ring, session.base) &&
      sameTangents(final.tangents, session.baseTangents))
  ) {
    return;
  }

  const target = reresolve(session);
  if (!target) return;
  const label =
    session.kind === 'group'
      ? 'Move wall'
      : session.kind === 'edge'
        ? 'Move edge'
        : session.kind === 'tangents'
          ? 'Bend curve'
          : session.kind === 'bow'
            ? 'Bend edge'
            : 'Move vertex';
  const ownerId = commitOutline(target, final.ring, label, final.tangents);
  if (ownerId && session.originalShapeId) useStore.getState().setShapeNodeEdit(ownerId);
}

/** The target again, after the rewind put the original children back. */
function reresolve(session: DragSession): OutlineTarget | null {
  if (session.originalShapeId) return resolveOutline(session.originalShapeId);
  const layer = useStore
    .getState()
    .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === session.layerId);
  if (!layer || session.ringIndex === null) return null;
  return resolveRingOutline(layer, session.ringIndex);
}

export function cancelOutlineDrag(): void {
  const session = drag;
  drag = null;
  if (!session) return;
  setChildren(session.layerId, session.beforeChildren);
  if (session.originalShapeId) useStore.getState().setShapeNodeEdit(session.originalShapeId);
}

function samePolygon(a: Polygon, b: Polygon): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);
}

function sameVec(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function sameTangents(a: RingTangents, b: RingTangents): boolean {
  if (a.length !== b.length) return false;
  return a.every((vt, i) => {
    const other = b[i];
    return sameVec(vt?.tin, other?.tin) && sameVec(vt?.tout, other?.tout);
  });
}

/** Apply an edit to whichever outline is in edit mode. */
export function applyOutlineEdit(edit: OutlineEdit, label: string): void {
  const state = useStore.getState();
  const shapeId = state.tools.shapeNodeEditId;
  if (!shapeId) return;
  const target = resolveOutline(shapeId);
  if (!target) return;
  const next = editedCurvedRing(target.outline, target.tangents, edit);
  if (!next) {
    // The one refusal a user actually runs into: deleting below three corners.
    // Refusing silently read as "delete is broken".
    if (edit.kind === 'delete') notify.warning('A room needs at least three corners');
    return;
  }
  const ownerId = commitOutline(target, next.ring, label, next.tangents);
  if (ownerId && ownerId !== shapeId) {
    // The collapse replaced the shape; keep editing the outline, not a ghost.
    useStore.getState().setShapeNodeEdit(ownerId);
  }
}
