import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DungeonLayer, Room, ThresholdSegment } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddWallCommand } from '../../store/commands';
import { AddThresholdCommand } from '../../store/roomCommands';
import { snapToAngle } from '../../geometry/drawAssist';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { thresholdToRects } from '../roomDetection';
import { roomIndexOf } from '../../shared/roomIndex';
import { computeArea, roomFace } from '../../shared/roomUtils';
import { resolveEditableLayer } from './layerGuard';

/*
 * Divide: drag a line across a floor. Its ends snap to the walls and the floor's edge
 * (wallEndpointSnap, in the canvas's input middleware), so the line reaches wall to
 * wall and actually cuts.
 *
 * In Threshold mode (`ui.dividerMode`) the line is a threshold: it cuts room faces and
 * blocks nothing. When it cuts one room's face in two, nothing is written yet: the cut
 * goes to `ui.pendingSplit` and the split dialog decides which half keeps the room.
 * Otherwise the threshold is added on its own. In Wall mode the line is a real wall.
 *
 * A drag too short to be a line is read as a click: the line then starts there and
 * the next click ends it, which is also how "Split here" hands the tool its first point.
 */

/** Shorter than this (cells) is a click, not a drag. */
const MIN_LINE = 0.25;
/** A face piece smaller than this (cells²) is a sliver from the cut's ends, not a half. */
const MIN_HALF_AREA = 0.05;

/** The first point a "Split here" handed over, adopted on the tool's next pointer event. */
let pendingStart: Point | null = null;

/** Start the next Divide line at `point` (the context menu's "Split here"). */
export function seedDivideStart(point: Point | null): void {
  pendingStart = point ? { x: point.x, y: point.y } : null;
}

/**
 * The two halves a threshold cuts `face` into, larger first, or null when it does not
 * cut it in two (it misses, or stops short of an edge). More than two pieces keep the
 * two largest; the slivers stay faces no room names.
 */
export function splitFace(
  face: [number, number][],
  threshold: ThresholdSegment,
): [[number, number][], [number, number][]] | null {
  if (face.length < 3) return null;
  const pieces = clipper2Engine
    .difference([face], thresholdToRects(threshold))
    .filter((p) => p.length >= 3)
    .map((p) => ({ ring: p as [number, number][], area: computeArea(p as [number, number][]) }))
    .filter((p) => p.area >= MIN_HALF_AREA)
    .sort((a, b) => b.area - a.area);
  if (pieces.length < 2) return null;
  return [pieces[0].ring, pieces[1].ring];
}

/**
 * The room a threshold splits, with its halves: the room under the line's middle
 * first, else the first room along the line whose face it cuts in two.
 */
export function roomSplitBy(
  layer: DungeonLayer,
  threshold: ThresholdSegment,
): { room: Room; halves: [[number, number][], [number, number][]] } | null {
  const rooms = layer.rooms ?? [];
  if (rooms.length === 0) return null;
  const [[ax, ay], [bx, by]] = [threshold.points[0], threshold.points[threshold.points.length - 1]];
  const index = roomIndexOf(rooms);
  const tried = new Set<string>();
  // The middle, then samples spreading out along the line.
  const ts = [0.5, 0.25, 0.75, 0.1, 0.9, 0.4, 0.6];
  for (const t of ts) {
    const room = index.roomAt(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (!room || tried.has(room.id) || room.orphaned) continue;
    tried.add(room.id);
    const halves = splitFace(roomFace(room), threshold);
    if (halves) return { room, halves };
  }
  return null;
}

export class DivideTool implements DrawingTool {
  readonly type = 'divide' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private start: Point | null = null;
  private current: Point | null = null;
  /** True between press and release of a drag; false once the line waits for its second click. */
  private dragging = false;
  private layerId: string | null = null;

  /** Adopt a seeded first point (Split here), once. */
  private adoptSeed(): void {
    if (!pendingStart || this.start) return;
    this.start = pendingStart;
    this.current = pendingStart;
    this.layerId = useStore.getState().ui.activeLayerId;
    pendingStart = null;
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    this.adoptSeed();
    if (this.start && !this.dragging) {
      // Second click of a click-click line.
      this.finish(this.constrain(point, event));
      return;
    }
    this.start = point;
    this.current = point;
    this.dragging = true;
    this.layerId = useStore.getState().ui.activeLayerId;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.adoptSeed();
    if (!this.start) return;
    this.current = this.constrain(point, event);
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    if (!this.dragging || !this.start) return;
    this.dragging = false;
    const end = this.constrain(point, event);
    // Too short to be a line: wait for the second click instead.
    if (Math.hypot(end.x - this.start.x, end.y - this.start.y) < MIN_LINE) return;
    this.finish(end);
  }

  /** Shift keeps the line straight: 15° steps off its first point. */
  private constrain(point: Point, event?: PointerEvent): Point {
    return event?.shiftKey && this.start ? snapToAngle(this.start, point) : point;
  }

  private finish(end: Point): void {
    const start = this.start;
    const layerId = this.layerId;
    this.reset();
    if (!start || !layerId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_LINE) return;
    const layer = resolveEditableLayer(layerId);
    if (!layer) return;
    const points: [number, number][] = [
      [start.x, start.y],
      [end.x, end.y],
    ];
    const store = useStore.getState();

    if (store.ui.dividerMode === 'wall') {
      undoManager.execute(
        new AddWallCommand('Divide with a wall', layerId, {
          id: crypto.randomUUID(),
          points,
          wallType: store.tools.settings.wallType,
          direction: store.tools.settings.wallDirection,
          color: layer.style.wallColor,
          roughness: 0,
        }),
      );
      return;
    }

    const threshold: ThresholdSegment = { id: crypto.randomUUID(), points };
    const split = roomSplitBy(layer, threshold);
    if (split) {
      store.setPendingSplit({ layerId, roomId: split.room.id, threshold, halves: split.halves });
      return;
    }
    undoManager.execute(new AddThresholdCommand(layerId, threshold));
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      pendingStart = null;
      this.cancel();
    }
  }

  getPreview(): PreviewShape | null {
    if (!this.start || !this.current) return null;
    return { type: 'line', points: [{ ...this.start }, { ...this.current }] };
  }

  private reset(): void {
    this.start = null;
    this.current = null;
    this.dragging = false;
    this.layerId = null;
  }

  cancel(): void {
    this.reset();
  }

  isActive(): boolean {
    return this.start !== null;
  }
}
