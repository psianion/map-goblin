import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import type { RoomChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';
import { simplifyPath } from '../../geometry/simplify';
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
 * Draws a room the DM owns: hold and trace a loop, release to close it.
 *
 * Placement only. Once committed the RoomChild is an ordinary ring child —
 * Select picks it, the gizmo transforms it, the outline node editor moves its
 * vertices — so there is deliberately no bespoke drag/gizmo state here (that is
 * ZoneTool's shape, and rooms are the case it does not fit).
 */
export class RoomTool implements DrawingTool {
  readonly type = 'room' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private points: Point[] = [];
  private drawing = false;
  /** The active layer when the stroke started — see WallTool for why. */
  private startLayerId: string | null = null;

  onPointerDown(point: Point): void {
    this.startLayerId = useStore.getState().ui.activeLayerId;
    this.points = [{ x: point.x, y: point.y }];
    this.drawing = true;
  }

  onPointerMove(point: Point): void {
    if (!this.drawing) return;
    this.push(point);
  }

  onPointerUp(point: Point): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.push(point);

    // Simplified against the raw trace, not the raw trace itself: RDP keeps the first and
    // last samples, which on a closed loop are neighbours, so the ring stays the loop drawn.
    const verts = simplifyPath(this.points, SIMPLIFY_EPSILON);
    const layerId = this.startLayerId;
    this.points = [];
    this.startLayerId = null;

    if (verts.length < 3 || !layerId) return;
    if (loopArea(verts) < MIN_AREA) return;

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
  }

  isActive(): boolean {
    return this.drawing;
  }
}
