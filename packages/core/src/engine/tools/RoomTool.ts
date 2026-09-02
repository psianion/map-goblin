import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer, RoomChild, ShapeChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';
import { isLayerEffectivelyVisible } from '../../store/selectors';
import { simplifyPath } from '../../geometry/simplify';
import { pointInPolygon } from '../hitTest';
import { effectiveContours } from './childTransform';
import { nextAuthoredName } from '../../shared/authoredRooms';

/** Freehand samples closer than this to the last kept one are pointer noise, not vertices. */
const MIN_SPACING = 0.2;

/**
 * How far the committed ring may sit from the stroke the DM actually drew.
 *
 * The raw trace is one vertex every {@link MIN_SPACING}, and every one of them becomes a
 * boundary occluder (O1): eight rooms and eight joints traced by hand came out at 2640
 * occluder walls, with `extractWallSegments` at 20ms cold. A sixth of a cell is under the
 * width of the line the overlay draws the loop with, so the room lands where it was drawn
 * and the sweep has a tenth of the edges to walk.
 */
const SIMPLIFY_EPSILON = 0.15;

/** A loop enclosing less than this is a stray click or a twitch, not a room. */
const MIN_AREA = 0.5;

/**
 * Loops with a mean width (2·area / perimeter) under this are a near-straight
 * drag whose wiggle happened to clear {@link MIN_AREA} — a sliver no one meant
 * as a room, found committing live. A quarter cell: the narrowest honest
 * corridor (half a cell wide) still clears it with room to spare.
 */
const MIN_MEAN_WIDTH = 0.25;

/**
 * How far off the edited ring a press has to land before it means "I'm done".
 *
 * The outline editor's insert marker sits ON the edge, and half of its 11px pick
 * radius therefore lies outside the ring — exiting on one of those would drop the
 * DM out of the mode on the very click that added a vertex. This tool has no
 * camera to convert that radius with, so it is the radius at 100% zoom (20px per
 * world unit); zoomed in the band is wider than the handle, which errs toward
 * staying in the mode.
 */
const EXIT_MARGIN = 0.55;

/** The layer being authored, or null when it cannot be drawn on. */
function activeDungeonLayer(): DungeonLayer | null {
  const state = useStore.getState();
  return (
    state.layers.find(
      (l): l is DungeonLayer =>
        l.type === 'dungeon' &&
        !l.locked &&
        l.id === state.ui.activeLayerId &&
        isLayerEffectivelyVisible(state, l),
    ) ?? null
  );
}

/** The room under `point`, topmost first — the order selection picks in. */
function roomAt(point: Point, exceptId?: string | null): RoomChild | null {
  const layer = activeDungeonLayer();
  if (!layer) return null;
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const c = layer.children[i];
    if (c.childType !== 'room' || !c.visible || c.id === exceptId) continue;
    if (pointInPolygon([point.x, point.y], effectiveContours(c)[0] ?? [])) return c;
  }
  return null;
}

/** The outer ring of whatever the outline editor is pointed at, transform baked. */
function editedRingOf(id: string): [number, number][] | null {
  for (const l of useStore.getState().layers) {
    if (l.type !== 'dungeon') continue;
    const c = l.children.find(
      (x): x is ShapeChild | RoomChild =>
        x.id === id && (x.childType === 'shape' || x.childType === 'room'),
    );
    if (c) return effectiveContours(c)[0] ?? null;
  }
  return null;
}

/** Distance from `p` to the closed ring's nearest edge. */
function distanceToRing(p: Point, ring: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lenSq));
    const d = Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** Signed shoelace area of the implicitly-closed loop. */
function loopArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Draws and reshapes the rooms the DM owns: press empty ground and trace a loop,
 * release to close it; press a room that is already there to bring its corners up.
 *
 * Placement and entry only. Once committed the RoomChild is an ordinary ring
 * child — Select picks it, the gizmo transforms it, the outline node editor moves
 * its vertices — so there is deliberately no bespoke drag/gizmo state here, and
 * no second editor: pressing a room just points the existing one at it.
 */
export class RoomTool implements DrawingTool {
  readonly type = 'room' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private points: Point[] = [];
  private drawing = false;
  /** The active layer when the stroke started — see WallTool for why. */
  private startLayerId: string | null = null;
  /** This gesture is the one that opened the edit, so its release must not close it. */
  private openedEdit = false;

  onPointerDown(point: Point): void {
    // A press inside a room the DM already drew edits that room rather than
    // starting a second one on top of it — the corners come up in the same
    // outline editor Select's double-click opens.
    const room = roomAt(point);
    if (room) {
      // Entering the mode IS the selection: setShapeNodeEdit clears selectedIds on
      // purpose, so the gizmo is not drawn around the room whose corners are up.
      useStore.getState().setShapeNodeEdit(room.id);
      this.openedEdit = true;
      return;
    }
    this.startLayerId = useStore.getState().ui.activeLayerId;
    this.points = [{ x: point.x, y: point.y }];
    this.drawing = true;
  }

  onPointerMove(point: Point): void {
    if (!this.drawing) return;
    this.push(point);
  }

  onPointerUp(point: Point): void {
    if (!this.drawing) {
      this.settleNodeEdit(point);
      return;
    }
    this.drawing = false;
    this.push(point);

    // Simplified against the raw trace, not the raw trace itself: RDP keeps the first and
    // last samples, which on a closed loop are neighbours, so the ring stays the loop drawn.
    const verts = simplifyPath(this.points, SIMPLIFY_EPSILON);
    const layerId = this.startLayerId;
    this.points = [];
    this.startLayerId = null;

    if (verts.length < 3 || !layerId) return;
    const area = loopArea(verts);
    if (area < MIN_AREA) return;
    let perimeter = 0;
    for (let i = 0; i < verts.length; i++) {
      const b = verts[(i + 1) % verts.length];
      perimeter += Math.hypot(b.x - verts[i].x, b.y - verts[i].y);
    }
    if ((2 * area) / perimeter < MIN_MEAN_WIDTH) return;

    // Validated against the layer the stroke started on — see WallTool.
    const layer = resolveEditableLayer(layerId);
    if (!layer) return;

    // The contour is an implicitly-closed ring, exactly like a polygon
    // ShapeChild's: the release point is the last vertex, not a repeat of the first.
    const child: RoomChild = {
      id: crypto.randomUUID(),
      name: nextAuthoredName(layer.children, 'Room'),
      childType: 'room',
      visible: true,
      contours: [verts.map((v): [number, number] => [v.x, v.y])],
    };
    undoManager.execute(new AddChildCommand('Draw room', layerId, child));
    useStore.getState().setSelectedIds([child.id]);
  }

  /**
   * Answers a press the outline editor already swallowed: switch the edit to
   * another room, or leave the mode.
   *
   * While `shapeNodeEditId` is set the canvas consumes every press itself — no
   * tool hears the pointerdown — so the release is the only part of that gesture
   * this tool sees. A press that grabbed a handle starts an outline drag, and a
   * drag's release returns before any tool is asked, so what arrives here is a
   * press that missed every handle: either it was inside another room, or it was
   * the DM putting the room down.
   */
  private settleNodeEdit(point: Point): void {
    const openedThisGesture = this.openedEdit;
    this.openedEdit = false;

    const state = useStore.getState();
    const editing = state.tools.shapeNodeEditId;
    if (!editing) return;

    const other = roomAt(point, editing);
    if (other) {
      state.setShapeNodeEdit(other.id);
      return;
    }

    // The press that opened the edit cannot also close it — dragged a little off
    // the room on the way up, it would otherwise show the corners and hide them
    // again in one gesture.
    if (openedThisGesture) return;

    const ring = editedRingOf(editing);
    if (!ring || ring.length < 3) return;
    if (pointInPolygon([point.x, point.y], ring)) return;
    if (distanceToRing(point, ring) < EXIT_MARGIN) return;
    state.setShapeNodeEdit(null);
  }

  private push(point: Point): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_SPACING) return;
    this.points.push({ x: point.x, y: point.y });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (this.points.length === 0) return null;
    return { type: 'polygon', points: this.points.map((p) => ({ x: p.x, y: p.y })) };
  }

  cancel(): void {
    this.points = [];
    this.drawing = false;
    this.startLayerId = null;
    this.openedEdit = false;
  }

  isActive(): boolean {
    return this.drawing;
  }
}
