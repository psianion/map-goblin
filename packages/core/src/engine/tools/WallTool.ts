import type { Point } from '../../types/geometry';
import { snapToAngle, smoothChain } from '../../geometry/drawAssist';
import { simplifyPath } from '../../geometry/simplify';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';
import { AddWallCommand, MergeWallsCommand } from '../../store/commands';
import { autoJoin } from '../../shared/wallJoin';
import type { WallSegment } from '../../store/types';
import { undoManager } from '../../store/undoManager';
import { resolveEditableLayer } from './layerGuard';

/** Two points closer than this are the same point. */
const MIN_SEGMENT = 0.01;

/** Freehand: raw points closer than this to the last, in cells, are not kept. */
const FREEHAND_STEP = 0.1;
/** A stroke shorter than this, in cells, is a slip, not a wall. */
const FREEHAND_MIN_LENGTH = 0.5;
/** Douglas-Peucker tolerance: the wall keeps no point nearer the stroke's line than this. */
const FREEHAND_TOLERANCE = 0.15;
/** An end this near the start, on a stroke longer than FREEHAND_LOOP_LENGTH, closes the loop. */
const FREEHAND_CLOSE = 0.75;
const FREEHAND_LOOP_LENGTH = 3;

/**
 * A freehand stroke as the chain a wall is drawn from: null when it is too short to be a
 * wall, simplified, and closed on its start point when it ends near it after a long run.
 */
export function freehandChain(stroke: readonly Point[]): Point[] | null {
  let length = 0;
  for (let i = 1; i < stroke.length; i++) length += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  if (length < FREEHAND_MIN_LENGTH) return null;
  const chain = simplifyPath([...stroke], FREEHAND_TOLERANCE).map((p) => ({ x: p.x, y: p.y }));
  const start = chain[0];
  const end = chain[chain.length - 1];
  if (chain.length >= 3 && length > FREEHAND_LOOP_LENGTH && Math.hypot(end.x - start.x, end.y - start.y) <= FREEHAND_CLOSE) {
    chain[chain.length - 1] = { x: start.x, y: start.y };
  }
  return chain;
}

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
 *
 * With Draw set to Freehand, a press with no chain open starts a stroke instead:
 * the drag's raw points (not grid-snapped) are kept, and the release simplifies
 * them into one chain and commits it the same way a clicked chain commits.
 */
export class WallTool implements DrawingTool {
  readonly type = 'wall' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  /**
   * The active layer when the chain started, captured so a lock/hide/switch
   * mid-chain can't smuggle a commit onto a layer the guard never checked.
   */
  private chainLayerId: string | null = null;
  /** The freehand stroke being dragged out, if one is. */
  private stroke: Point[] | null = null;

  /** The engine maps a pointer to its raw world point; without one the point given is used. */
  private readonly engine: Pick<RenderEngine, 'canvas' | 'screenToWorld'> | undefined;

  constructor(engine?: Pick<RenderEngine, 'canvas' | 'screenToWorld'>) {
    this.engine = engine;
  }

  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event || !this.engine) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (this.vertices.length === 0 && useStore.getState().tools.settings.wallDraw === 'freehand') {
      if (event && event.button !== 0) return;
      this.chainLayerId = useStore.getState().ui.activeLayerId;
      this.stroke = [this.strokeEnd(point, event)];
      return;
    }
    const now = Date.now();
    if (this.vertices.length >= 2 && isDoubleClick(this.lastClick, point, now)) {
      this.finalize();
      return;
    }
    if (this.vertices.length === 0) {
      this.chainLayerId = useStore.getState().ui.activeLayerId;
    }
    point = this.constrain(point, event);
    this.lastClick = { point, time: now };
    this.vertices.push(point);
    this.currentPoint = point;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    if (this.stroke) {
      const p = this.rawWorld(point, event);
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= FREEHAND_STEP) this.stroke.push(p);
      return;
    }
    this.currentPoint = this.constrain(point, event);
  }

  /** Shift constrains the pending segment to 15° multiples off the last anchor. */
  private constrain(point: Point, event?: PointerEvent): Point {
    const anchor = this.vertices[this.vertices.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : point;
  }

  /**
   * Where a freehand stroke starts or ends: the point given when the endpoint snap put it
   * on a drawn wall, so the stroke joins that wall, else the raw pointer, free of the grid
   * like the rest of the stroke.
   */
  private strokeEnd(point: Point, event?: PointerEvent): Point {
    const layer = useStore.getState().layers.find((l) => l.id === this.chainLayerId);
    const onWall =
      layer?.type === 'dungeon' &&
      layer.standaloneWalls.some((w) => w.points.some(([x, y]) => Math.hypot(x - point.x, y - point.y) <= MIN_SEGMENT));
    return onWall ? point : this.rawWorld(point, event);
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    const chain = freehandChain([...stroke, this.strokeEnd(point, event)]);
    if (!chain) {
      this.chainLayerId = null;
      return;
    }
    this.vertices = chain;
    this.finalize();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter') {
      if (this.vertices.length >= 2) this.finalize();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.stroke) return this.stroke.length > 1 ? { type: 'line', points: this.stroke.map((p) => ({ x: p.x, y: p.y })) } : null;
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
    this.chainLayerId = null;
    this.stroke = null;
  }

  isActive(): boolean {
    return this.vertices.length > 0 || this.stroke !== null;
  }

  private finalize(): void {
    let verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;
    this.lastClick = null;
    const activeLayerId = this.chainLayerId;
    this.chainLayerId = null;

    if (verts.length < 2 || !activeLayerId) return;

    const store = useStore.getState();
    // Curve mode bakes the smoothed polyline into the segment — downstream
    // (layout engine, node editing, serialization) sees ordinary points.
    if (store.tools.curveMode) verts = smoothChain(verts);
    // Validated against the layer the chain started on, not whatever is
    // active now — locking it, hiding it, or switching away mid-chain must
    // not let Enter commit somewhere the guard never checked.
    const activeLayer = resolveEditableLayer(activeLayerId);
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

    const wall: WallSegment = {
      id: crypto.randomUUID(),
      points,
      wallType: store.tools.settings.wallType,
      direction: store.tools.settings.wallDirection,
      color: activeLayer.style.wallColor,
      // No width: a drawn wall takes the layer's, and follows it when it changes.
      roughness: 0,
    };
    // Auto-join: a chain started or finished on a wall's free end, of the same set and
    // type, becomes part of that wall rather than a second wall touching it.
    const joined = store.tools.settings.wallAutoJoin === false ? null : autoJoin(wall, activeLayer.standaloneWalls, activeLayer.style);
    undoManager.execute(
      joined
        ? new MergeWallsCommand('Draw wall', activeLayerId, joined.merged, joined.removed)
        : new AddWallCommand('Draw wall', activeLayerId, wall),
    );
  }
}
