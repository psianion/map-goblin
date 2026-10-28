import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DungeonLayer, Room, ShapeChild } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createDrawRoomCommand } from '../../store/roomCommands';
import { interiorPoint, nextRoomNumber } from '../../shared/roomUtils';
import { RectangleTool } from './RectangleTool';
import { PolygonTool } from './PolygonTool';

/*
 * The two room tools: the Rectangle and Polygon floor tools, unchanged in how they
 * draw, with a different commit. The finished floor and a new room anchored inside
 * it land as one composite (`createDrawRoomCommand`), so one undo takes both back.
 * `ui.roomWalls` decides whether the floor gets stones round it.
 */

/** The room a freshly drawn floor gets: next number on the layer, anchored inside the ring. */
export function roomForFloor(layer: DungeonLayer, shape: ShapeChild): Room {
  const number = nextRoomNumber(layer.rooms);
  const ring = shape.contours[0] ?? [];
  return {
    id: crypto.randomUUID(),
    name: `Room ${number}`,
    number,
    anchor: interiorPoint(ring),
  };
}

/** Commit a drawn floor as a room: the floor and the room in one undo step. */
export function commitRoomFloor(layer: DungeonLayer, shape: ShapeChild): void {
  const room = roomForFloor(layer, shape);
  const floor: ShapeChild = { ...shape, name: `${room.name} floor` };
  undoManager.execute(createDrawRoomCommand(layer.id, floor, room, useStore.getState().ui.roomWalls));
}

/** Forwards every call to the floor tool it wraps; only the commit differs. */
abstract class WrappedFloorTool implements DrawingTool {
  abstract readonly type: DrawingTool['type'];
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  protected abstract readonly inner: DrawingTool;

  onPointerDown(point: Point, event?: PointerEvent): void {
    this.inner.onPointerDown(point, event);
  }
  onPointerMove(point: Point, event?: PointerEvent): void {
    this.inner.onPointerMove(point, event);
  }
  onPointerUp(point: Point, event?: PointerEvent): void {
    this.inner.onPointerUp(point, event);
  }
  onKeyDown(event: KeyboardEvent): void {
    this.inner.onKeyDown(event);
  }
  getPreview(): PreviewShape | null {
    return this.inner.getPreview();
  }
  cancel(): void {
    this.inner.cancel();
  }
  isActive(): boolean {
    return this.inner.isActive();
  }
}

/** Drag a rectangle: the floor, its walls and the room land together. */
export class RoomRectTool extends WrappedFloorTool {
  readonly type = 'roomRect' as const;
  protected readonly inner = new RectangleTool(commitRoomFloor);
}

/** Click a polygon: the floor, its walls and the room land together. */
export class RoomPolygonTool extends WrappedFloorTool {
  readonly type = 'roomPolygon' as const;
  protected readonly inner = new PolygonTool(commitRoomFloor);
}
