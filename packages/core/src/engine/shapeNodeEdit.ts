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

function centroid(poly: Polygon): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
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
  return targetFor(layer, outline);
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

  const contributors = () =>
    layer.children.filter((c): c is ShapeChild => {
      if (c.childType !== 'shape' || !c.visible) return false;
      const r = ringOf(c);
      if (r.length < 3) return false;
      // Overlaps the outline, so it helped form it.
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
  | { kind: 'delete'; index: number };

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
  }
}

function makePolygonShape(name: string, contours: Polygon[], from: ShapeChild): ShapeChild {
  return {
    ...from,
    id: crypto.randomUUID(),
    name,
    childType: 'shape',
    shapeType: 'polygon',
    contours: contours.map((r) => r.map(([x, y]): [number, number] => [x, y])),
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
): string | null {
  const { layer } = target;
  const contours = contoursWith(target, next);
  const contributors = target.contributors();
  if (contributors.length === 0) return null;

  if (contributors.length === 1) {
    const only = contributors[0];
    undoManager.execute(
      new UpdateChildCommand(
        label,
        layer.id,
        only.id,
        { contours: only.contours, transform: only.transform } as Partial<AnyChild>,
        { contours, transform: undefined } as Partial<AnyChild>,
      ),
    );
    return only.id;
  }

  const merged = makePolygonShape(contributors[0].name, contours, contributors[0]);
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
  /** The rest of the shape, so a preview frame can write whole contours. */
  rings: Pick<OutlineTarget, 'outline' | 'holes' | 'hole'>;
  kind: 'vertex' | 'edge' | 'group';
  index: number;
  /** Vertices a group drag displaces together. */
  indices: number[];
  /** Shape carrying the outline during the preview. */
  ownerId: string;
  collapsed: boolean;
  latest: Polygon | null;
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

/** Start dragging a vertex or an edge. Returns false if there is nothing to drag. */
export function beginOutlineDrag(kind: 'vertex' | 'edge', index: number): boolean {
  const shapeId = useStore.getState().tools.shapeNodeEditId;
  if (!shapeId) return false;
  const target = resolveOutline(shapeId);
  if (!target) return false;
  return startDrag(target, {
    shapeId,
    ringIndex: null,
    base: target.outline,
    kind,
    index,
    indices: [],
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
  });
}

function startDrag(
  target: OutlineTarget,
  session: Pick<DragSession, 'ringIndex' | 'kind' | 'index' | 'indices'> & {
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
    rings: { outline: target.outline, holes: target.holes, hole: target.hole },
    kind: session.kind,
    index: session.index,
    indices: session.indices,
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
export function updateOutlineDrag(world: Point, delta: Point): void {
  if (!drag) return;
  let next: Polygon | null;
  if (drag.kind === 'group') {
    // Unsnapped on purpose: the anchors sit wherever the stones happened to
    // stand, so snapping them to the grid would shear the bulge sideways.
    const moved = new Set(drag.indices);
    next = drag.base.map(([x, y], i): [number, number] =>
      moved.has(i) ? [x + delta.x, y + delta.y] : [x, y],
    );
  } else {
    next = editedOutline(
      drag.base,
      drag.kind === 'vertex'
        ? { kind: 'move', index: drag.index, x: world.x, y: world.y }
        : { kind: 'moveEdge', index: drag.index, dx: delta.x, dy: delta.y },
    );
  }
  if (!next) return;
  drag.latest = next;
  useStore
    .getState()
    .updateChild(drag.layerId, drag.ownerId, {
      contours: contoursWith(drag.rings, next),
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

  if (!final || samePolygon(final, session.base)) return;

  const target = reresolve(session);
  if (!target) return;
  const label =
    session.kind === 'group' ? 'Move wall' : session.kind === 'edge' ? 'Move edge' : 'Move vertex';
  const ownerId = commitOutline(target, final, label);
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

/** Apply an edit to whichever outline is in edit mode. */
export function applyOutlineEdit(edit: OutlineEdit, label: string): void {
  const state = useStore.getState();
  const shapeId = state.tools.shapeNodeEditId;
  if (!shapeId) return;
  const target = resolveOutline(shapeId);
  if (!target) return;
  const next = editedOutline(target.outline, edit);
  if (!next) return;
  const ownerId = commitOutline(target, next, label);
  if (ownerId && ownerId !== shapeId) {
    // The collapse replaced the shape; keep editing the outline, not a ghost.
    useStore.getState().setShapeNodeEdit(ownerId);
  }
}
