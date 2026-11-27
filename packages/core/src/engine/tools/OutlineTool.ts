import type { Point } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Room } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddRoomCommand, SetRoomBoundaryCommand } from '../../store/roomCommands';
import { interiorPoint, nextRoomNumber, signedArea } from '../../shared/roomUtils';
import { resolveEditableLayer } from './layerGuard';

/*
 * The Outline tool: marks a room by drawing its outline over whatever floor is there, a
 * cave chamber, painted ground, a picture. Drag for a rectangle; click for corners, closed
 * by Enter or a click on the first one. It lays no floor and no walls: the room's face is
 * the outline cut to the floor under it, and on a picture-only map the outline itself.
 *
 * One undo step makes a numbered room, `Room N`. While the card's Outline it is pending
 * (`ui.outlineRoomId`), the outline goes to that room instead.
 */

/** A press that travels this far (world units) before release is a drag: a rectangle. */
const DRAG_MIN = 0.25;
/** A click this close to the first corner closes the outline. */
const CLOSE_THRESHOLD = 0.2;
/** Outlines smaller than this (square cells) are a slip, not a room. */
const MIN_AREA = 0.25;

/**
 * Make `ring` a room on `layerId`, or give it to the room the card asked for, as one undo
 * step. Returns the room's id, or null when nothing was made.
 */
export function commitOutlineRoom(layerId: string, ring: [number, number][]): string | null {
  if (ring.length < 3 || Math.abs(signedArea(ring)) < MIN_AREA) return null;
  const layer = resolveEditableLayer(layerId);
  if (!layer) return null;
  const state = useStore.getState();
  const targetId = state.ui.outlineRoomId;
  if (targetId) {
    useStore.setState((s) => {
      s.ui.outlineRoomId = null;
    });
  }
  const target = targetId ? layer.rooms?.find((r) => r.id === targetId) : undefined;
  if (target) {
    undoManager.execute(new SetRoomBoundaryCommand(layer.id, target.id, ring, interiorPoint(ring)));
    return target.id;
  }
  const number = nextRoomNumber(layer.rooms);
  const room: Room = { id: crypto.randomUUID(), name: `Room ${number}`, number, anchor: interiorPoint(ring), boundary: ring };
  undoManager.execute(new AddRoomCommand(layer.id, room));
  return room.id;
}

export class OutlineTool implements DrawingTool {
  readonly type = 'outline' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  /** Corners clicked so far. */
  private corners: Point[] = [];
  private current: Point | null = null;
  /** A press not yet released, and whether it has travelled far enough to be a drag. */
  private press: Point | null = null;
  private dragging = false;
  /** The active layer when the outline started; it lands there. */
  private layerId: string | null = null;

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (this.corners.length >= 3) {
      const first = this.corners[0];
      if (Math.hypot(point.x - first.x, point.y - first.y) < CLOSE_THRESHOLD) {
        this.finish();
        return;
      }
    }
    if (this.corners.length === 0) this.layerId = useStore.getState().ui.activeLayerId;
    this.press = this.corners.length === 0 ? point : this.constrain(point, event);
    this.dragging = false;
    this.current = this.press;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    if (this.press && this.corners.length === 0 && !this.dragging) {
      this.dragging = Math.hypot(point.x - this.press.x, point.y - this.press.y) >= DRAG_MIN;
    }
    this.current = this.dragging ? point : this.constrain(point, event);
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    if (this.dragging) {
      this.dragging = false;
      const a = press;
      const b = point;
      this.current = null;
      const layerId = this.layerId;
      this.layerId = null;
      if (!layerId || Math.abs(b.x - a.x) < 0.01 || Math.abs(b.y - a.y) < 0.01) return;
      commitOutlineRoom(layerId, [
        [a.x, a.y],
        [b.x, a.y],
        [b.x, b.y],
        [a.x, b.y],
      ]);
      return;
    }
    // A click: one more corner.
    this.corners.push(this.corners.length === 0 ? press : this.constrain(press, event));
  }

  /** Shift keeps the next side to 15 degree steps off the last corner, as Divide does. */
  private constrain(point: Point, event?: PointerEvent): Point {
    const last = this.corners[this.corners.length - 1];
    return event?.shiftKey && last ? snapToAngle(last, point) : point;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (event.key === 'Enter' && this.corners.length >= 3) this.finish();
  }

  getPreview(): PreviewShape | null {
    if (this.dragging && this.press && this.current) {
      const s = this.press;
      const e = this.current;
      return { type: 'polygon', points: [{ x: s.x, y: s.y }, { x: e.x, y: s.y }, { x: e.x, y: e.y }, { x: s.x, y: e.y }] };
    }
    if (this.corners.length === 0) return null;
    const pts = this.corners.map((p) => ({ x: p.x, y: p.y }));
    if (this.current) pts.push({ x: this.current.x, y: this.current.y });
    return { type: 'polygon', points: pts };
  }

  cancel(): void {
    this.corners = [];
    this.current = null;
    this.press = null;
    this.dragging = false;
    this.layerId = null;
  }

  isActive(): boolean {
    return this.corners.length > 0 || this.press !== null;
  }

  private finish(): void {
    const ring = this.corners.map((p): [number, number] => [p.x, p.y]);
    const layerId = this.layerId;
    this.cancel();
    if (layerId) commitOutlineRoom(layerId, ring);
  }
}
