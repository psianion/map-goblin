import type { Point } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import { simplifyPath } from '../../geometry/simplify';
import { buildRibbon } from '../../geometry/ribbon';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { addPath } from '../../store/pathCommands';
import type { PathChild, PathPoint } from '../../shared/types';
import { resolveEditableLayer } from './layerGuard';
import { bridgeHeights, isBridgeMaterial } from '../../shared/plateaus';

/** The material a lake is drawn in. */
export const LAKE_MATERIAL_ID = 'gg-forge:water';
/** A press that travels this far (screen px) before release draws freehand. */
const FREEHAND_PX = 4;
/** Freehand samples are taken this far apart, cells… */
const FREEHAND_STEP = 0.3;
/** …and simplified (Douglas-Peucker) to points no further than this off the stroke. */
const FREEHAND_TOLERANCE = 0.08;
/** The wheel and `[` `]` change the width by this, Shift by the fine step. */
export const PATH_WIDTH_STEP = 0.25;
export const PATH_WIDTH_FINE_STEP = 0.05;
export const PATH_WIDTH_RANGE = { min: 0.25, max: 20 } as const;
/** How close a click lands to the first point to close the path, and to another path's end to join it. */
const LAND_RADIUS = 0.35;

let live = false;
/** True while the Path tool holds points: its keys (Backspace, `[`, `]`) are the tool's then. */
export function pathChainLive(): boolean {
  return live;
}

function clampWidth(w: number): number {
  return Math.min(PATH_WIDTH_RANGE.max, Math.max(PATH_WIDTH_RANGE.min, Math.round(w * 100) / 100));
}

/** The point snapped onto the nearest end of another path on the layer, else onto the grid when snap is on. */
export function snapPathPoint(point: Point, layerId: string | null): Point {
  const state = useStore.getState();
  if (state.tools.settings.path.snapEnds) {
    const layer = state.layers.find((l) => l.id === layerId);
    let best: Point | null = null;
    let bestD = LAND_RADIUS;
    if (layer?.type === 'dungeon') {
      for (const c of layer.children) {
        if (c.childType !== 'path' || c.closed || c.points.length < 2) continue;
        for (const end of [c.points[0], c.points[c.points.length - 1]]) {
          const d = Math.hypot(end.x - point.x, end.y - point.y);
          if (d < bestD) {
            bestD = d;
            best = { x: end.x, y: end.y };
          }
        }
      }
    }
    if (best) return best;
  }
  const { snapEnabled, snapDivision } = state.grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return { x: Math.round(point.x / interval) * interval, y: Math.round(point.y / interval) * interval };
}

/**
 * The Path tool (A), and the same tool preset to water, closed and filled (U, `lake`).
 *
 * Click places a point; a press dragged past a few pixels draws freehand, simplified into
 * points with auto tangents. The wheel and `[` `]` set the width of the point about to be
 * placed; Backspace takes the last point back; landing on the first point closes the path;
 * Alt makes the segment into the new point straight; Shift holds it to 15° steps. Enter,
 * a double-click or a right-click finishes; Escape drops it. One undo entry per path.
 */
export class PathTool implements DrawingTool {
  readonly type: 'path' | 'lake';
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private points: PathPoint[] = [];
  private cursorPoint: Point | null = null;
  /** The dock width when the chain started: the path's own width. Points that differ carry theirs. */
  private startWidth: number | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  private press: { screen: { x: number; y: number }; samples: Point[]; freehand: boolean } | null = null;
  /** The active layer when the chain started — see WallTool for why. */
  private chainLayerId: string | null = null;

  constructor(type: 'path' | 'lake' = 'path') {
    this.type = type;
  }

  private settings() {
    return useStore.getState().tools.settings.path;
  }

  /** The next point's width: the dock's, which the wheel and `[` `]` move while drawing. */
  private widthNow(): number {
    return this.settings().width;
  }

  /** The point a width is stored on: only when it differs from the path's own width. */
  private withWidth(p: Point, extra: Partial<PathPoint> = {}): PathPoint {
    const w = this.widthNow();
    const base = this.startWidth ?? w;
    return { x: p.x, y: p.y, ...(Math.abs(w - base) > 1e-9 ? { width: w } : {}), ...extra };
  }

  private place(point: Point, event?: PointerEvent): Point {
    const anchor = this.points[this.points.length - 1];
    const snapped = snapPathPoint(point, this.chainLayerId);
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : snapped;
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    const now = Date.now();
    if (this.points.length >= 2 && isDoubleClick(this.lastClick, point, now)) {
      this.lastClick = null;
      this.finish();
      return;
    }
    if (this.points.length === 0) {
      this.chainLayerId = useStore.getState().ui.activeLayerId;
      this.startWidth = this.settings().width;
    }
    const first = this.points[0];
    if (first && this.points.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= LAND_RADIUS) {
      this.finish(true);
      return;
    }
    const at = this.place(point, event);
    if (event?.altKey && this.points.length > 0) {
      // A straight segment: sharp at both of its ends.
      this.points[this.points.length - 1] = { ...this.points[this.points.length - 1], handles: null };
      this.points.push(this.withWidth(at, { handles: null }));
    } else {
      this.points.push(this.withWidth(at));
    }
    live = true;
    this.lastClick = { point: at, time: now };
    this.cursorPoint = at;
    this.press = { screen: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, samples: [at], freehand: false };
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const press = this.press;
    if (press && event && (event.buttons & 1) === 1) {
      if (!press.freehand && Math.hypot(event.clientX - press.screen.x, event.clientY - press.screen.y) > FREEHAND_PX) {
        press.freehand = true;
      }
      if (press.freehand) {
        const last = press.samples[press.samples.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= FREEHAND_STEP) press.samples.push(point);
      }
    }
    if (this.points.length === 0) {
      this.cursorPoint = point;
      return;
    }
    const anchor = this.points[this.points.length - 1];
    this.cursorPoint = event?.shiftKey ? snapToAngle(anchor, point) : snapPathPoint(point, this.chainLayerId);
  }

  onPointerUp(point: Point): void {
    const press = this.press;
    this.press = null;
    if (!press?.freehand) return;
    const samples = [...press.samples];
    const tail = samples[samples.length - 1];
    if (Math.hypot(point.x - tail.x, point.y - tail.y) > 1e-6) samples.push(point);
    const kept = simplifyPath(samples, FREEHAND_TOLERANCE).slice(1);
    if (kept.length === 0) return;
    const end = kept.length - 1;
    kept[end] = snapPathPoint(kept[end], this.chainLayerId);
    for (const p of kept) this.points.push(this.withWidth(p));
    // One stroke, one path: a freehand drag finishes on release.
    this.finish();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter') {
      this.finish();
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      this.points.pop();
      if (this.points.length === 0) this.cancel();
    } else if (event.key === '[' || event.key === ']') {
      this.stepWidth(event.key === ']' ? 1 : -1, event.shiftKey);
    }
  }

  /** The wheel, while placing: the next point's width. Idle, the wheel stays the view's. */
  onWheel(e: WheelEvent): boolean {
    if (this.points.length === 0) return false;
    this.stepWidth((e.deltaY || e.deltaX) < 0 ? 1 : -1, e.shiftKey);
    return true;
  }

  /** Moves the dock width, so the change shows there and the next path starts from it. */
  private stepWidth(dir: 1 | -1, fine: boolean): void {
    const path = this.settings();
    const width = clampWidth(path.width + dir * (fine ? PATH_WIDTH_FINE_STEP : PATH_WIDTH_STEP));
    useStore.getState().updateToolSettings({ path: { ...path, width } });
  }

  /** The next point's width, cells. */
  get width(): number {
    return this.widthNow();
  }

  onContextMenu(): boolean {
    if (this.points.length === 0) return false;
    this.finish();
    return true;
  }

  getPreview(): PreviewShape | null {
    if (this.points.length === 0) return null;
    const pts = [...this.points];
    for (const s of this.press?.freehand ? this.press.samples.slice(1) : []) pts.push(this.withWidth(s));
    if (this.cursorPoint && !this.press?.freehand) pts.push(this.withWidth(this.cursorPoint));
    const closed = this.type === 'lake' && pts.length >= 3;
    const mesh = buildRibbon(pts, closed, this.startWidth ?? this.widthNow(), { ends: { start: 'fade', end: 'fade', length: 0 } });
    const n = mesh.positions.length / 4;
    if (n < 2) return { type: 'circle', points: [pts[0]] };
    const outline: Point[] = [];
    for (let i = 0; i < n; i++) outline.push({ x: mesh.positions[i * 4], y: mesh.positions[i * 4 + 1] });
    for (let i = n - 1; i >= 0; i--) outline.push({ x: mesh.positions[i * 4 + 2], y: mesh.positions[i * 4 + 3] });
    return { type: 'polygon', points: outline };
  }

  cancel(): void {
    this.points = [];
    this.cursorPoint = null;
    this.lastClick = null;
    this.press = null;
    this.chainLayerId = null;
    this.startWidth = null;
    live = false;
  }

  isActive(): boolean {
    return this.points.length > 0;
  }

  private finish(close = false): void {
    const points = this.points;
    const width = this.startWidth ?? this.settings().width;
    const layerId = this.chainLayerId;
    this.cancel();
    const lake = this.type === 'lake';
    const closed = close || lake;
    if (!layerId || points.length < (closed ? 3 : 2)) return;
    const layer = resolveEditableLayer(layerId);
    if (!layer) return;
    const s = this.settings();
    const count = layer.children.filter((c) => c.childType === 'path').length + 1;
    const materialId = lake ? s.lakeMaterialId : s.materialId;
    // A bridge's ends stand at the height of the ground they rest on.
    const bridge = !closed && s.heightMode === 'set' && isBridgeMaterial(materialId);
    const path: PathChild = {
      id: crypto.randomUUID(),
      name: `${lake ? 'Lake' : 'Path'} ${count}`,
      childType: 'path',
      visible: true,
      points: bridge ? bridgeHeights(layer, points) : points,
      closed,
      ...(lake ? { fill: true } : {}),
      width,
      heightMode: s.heightMode,
      materialId,
      tint: '#ffffff',
      opacity: 1,
      // The strip is four cells long; a random start keeps two paths from repeating in step.
      offset: Math.round(Math.random() * 400) / 100,
      flip: false,
      edge: s.edge,
      ends: { ...s.ends },
      sort: s.sort,
      ...(s.crossingId ? { crossingId: s.crossingId } : {}),
    };
    undoManager.execute(addPath(layerId, path));
  }
}
