import type { Point } from '../../types/geometry';
import { snapToAngle, smoothChain } from '../../geometry/drawAssist';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddWallCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer } from '../../store/types';

/** Two points closer than this are the same point. */
const MIN_SEGMENT = 0.01;

/**
 * Chained wall tool — click to drop anchors, double-click or Enter to commit,
 * Escape to cancel. Same interaction as PathTool and PolygonTool.
 *
 * This used to commit one 2-point WallSegment per drag, which is why a drawn
 * chain rendered wrong: every WallSegment is capped at both ends, so an N-click
 * chain produced 2N end-caps with pairs of them stacked at each interior joint.
 * One chain is now one WallSegment with N points, so only points[0] and
 * points[last] are ends and the joints become interior vertices the layout
 * engine carries properly.
 */
export class WallTool implements DrawingTool {
  readonly type = 'wall' as const;
  readonly cursor = 'crosshair';
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;

  onPointerDown(point: Point, event?: PointerEvent): void {
    const now = Date.now();
    if (this.vertices.length >= 2 && isDoubleClick(this.lastClick, point, now)) {
      this.finalize();
      return;
    }
    point = this.constrain(point, event);
    this.lastClick = { point, time: now };
    this.vertices.push(point);
    this.currentPoint = point;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.currentPoint = this.constrain(point, event);
  }

  /** Shift constrains the pending segment to 15° multiples off the last anchor. */
  private constrain(point: Point, event?: PointerEvent): Point {
    const anchor = this.vertices[this.vertices.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : point;
  }

  onPointerUp(_point: Point): void {}

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter') {
      if (this.vertices.length >= 2) this.finalize();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.vertices.length === 0) return null;
    let points = this.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (this.currentPoint) {
      points.push({ x: this.currentPoint.x, y: this.currentPoint.y });
    }
    // Preview the same curve the commit will produce.
    if (useStore.getState().tools.curveMode) points = smoothChain(points);
    return { type: 'line', points };
  }

  cancel(): void {
    this.vertices = [];
    this.currentPoint = null;
    this.lastClick = null;
  }

  isActive(): boolean {
    return this.vertices.length > 0;
  }

  private finalize(): void {
    let verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;
    this.lastClick = null;

    if (verts.length < 2) return;

    const store = useStore.getState();
    // Curve mode bakes the smoothed polyline into the segment — downstream
    // (layout engine, node editing, serialization) sees ordinary points.
    if (store.tools.curveMode) verts = smoothChain(verts);
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    // Drop repeats — endpoint snapping makes exact duplicates easy to produce,
    // and a zero-length run gives the layout engine a NaN direction.
    const points: [number, number][] = [[verts[0].x, verts[0].y]];
    for (let i = 1; i < verts.length; i++) {
      const [px, py] = points[points.length - 1];
      if (Math.hypot(verts[i].x - px, verts[i].y - py) >= MIN_SEGMENT) {
        points.push([verts[i].x, verts[i].y]);
      }
    }
    if (points.length < 2) return;

    undoManager.execute(
      new AddWallCommand('Draw wall', activeLayerId, {
        id: crypto.randomUUID(),
        points,
        wallType: store.tools.settings.wallType,
        direction: store.tools.settings.wallDirection,
        color: activeLayer.style.wallColor,
        width: activeLayer.style.wallWidth,
        roughness: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
      }),
    );
  }
}
