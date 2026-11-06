import type { Point } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import { simplifyPath } from '../../geometry/simplify';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand } from '../../store/commands';
import type { DungeonLayer, PlateauChild, PlateauToolSettings } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';
import { notify } from '../../shared/notify';
import { GROUND_MESSAGE, SMALL_MESSAGE } from '../../shared/plateauGround';
import { plateauGround } from '../plateauGround';

/** A press that travels this far (screen px) before release draws freehand, as the Path tool's does. */
const FREEHAND_PX = 4;
/** Freehand samples are taken this far apart, cells… */
const FREEHAND_STEP = 0.3;
/** …and simplified (Douglas-Peucker) to points no further than this off the stroke. */
const FREEHAND_TOLERANCE = 0.08;
/** How close a click lands to the first point to close the ring, cells. */
const CLOSE_RADIUS = 0.35;

export const PLATEAU_DEFAULTS: PlateauToolSettings = { height: 1, edge: 'cliff' };

/** The tool's settings with their defaults filled in. */
export function plateauSettings(): PlateauToolSettings {
  return { ...PLATEAU_DEFAULTS, ...useStore.getState().tools.settings.plateau };
}

/** The point on the grid when snap is on. */
function snapToGrid(point: Point): Point {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return { x: Math.round(point.x / interval) * interval, y: Math.round(point.y / interval) * interval };
}

/**
 * Adds plateau `ring` to layer `layerId` at the tool's height and edge, selected, as one undo
 * step: only where it stands on ground (the layer's floor or painted terrain) and covers a
 * cell, else a toast and nothing. Resolves to the new plateau, or null.
 */
export async function commitPlateau(layerId: string, ring: Point[]): Promise<PlateauChild | null> {
  const layer = resolveEditableLayer(layerId);
  if (!layer || ring.length < 3) return null;
  const contour = ring.map((p): [number, number] => [p.x, p.y]);
  const verdict = await plateauGround(layer as DungeonLayer, contour);
  if (verdict !== 'ok') {
    notify.warning(verdict === 'small' ? SMALL_MESSAGE : GROUND_MESSAGE);
    return null;
  }
  const now = resolveEditableLayer(layerId);
  if (!now) return null;
  const s = plateauSettings();
  const count = now.children.filter((c) => c.childType === 'plateau').length + 1;
  const plateau: PlateauChild = {
    id: crypto.randomUUID(),
    name: `Plateau ${count}`,
    childType: 'plateau',
    visible: true,
    contours: [contour],
    height: s.height,
    edge: s.edge,
  };
  undoManager.execute(new AddChildCommand('Add plateau', layerId, plateau));
  useStore.getState().setSelectedIds([plateau.id]);
  return plateau;
}

/**
 * The Plateau tool (E): a ring of relief over floors or painted terrain.
 *
 * A press dragged past a few pixels draws the ring freehand, simplified as the Path tool
 * simplifies, and finishes on release. Clicks place points; a click on the first point closes
 * the ring; Shift holds a segment to 15° steps; Enter or a double-click finishes; Escape drops
 * it. The ring must stand on ground (`commitPlateau`). One undo entry per plateau.
 */
export class PlateauTool implements DrawingTool {
  readonly type = 'plateau' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private points: Point[] = [];
  private cursorPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  private press: { screen: { x: number; y: number }; samples: Point[]; freehand: boolean } | null = null;
  /** The active layer when the ring started — see WallTool for why. */
  private chainLayerId: string | null = null;

  private place(point: Point, event?: PointerEvent): Point {
    const anchor = this.points[this.points.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : snapToGrid(point);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    const now = Date.now();
    if (this.points.length >= 3 && isDoubleClick(this.lastClick, point, now)) {
      this.lastClick = null;
      this.finish();
      return;
    }
    if (this.points.length === 0) this.chainLayerId = useStore.getState().ui.activeLayerId;
    const first = this.points[0];
    if (first && this.points.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= CLOSE_RADIUS) {
      this.finish();
      return;
    }
    const at = this.place(point, event);
    this.points.push(at);
    this.lastClick = { point: at, time: now };
    this.cursorPoint = at;
    this.press = { screen: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, samples: [point], freehand: false };
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
    const anchor = this.points[this.points.length - 1];
    this.cursorPoint = anchor && event?.shiftKey ? snapToAngle(anchor, point) : point;
  }

  onPointerUp(point: Point): void {
    const press = this.press;
    this.press = null;
    if (!press?.freehand) return;
    const samples = [...press.samples];
    const tail = samples[samples.length - 1];
    if (Math.hypot(point.x - tail.x, point.y - tail.y) > 1e-6) samples.push(point);
    // A freehand stroke is the whole ring when it started it; otherwise it adds to the clicks.
    const kept = simplifyPath(samples, FREEHAND_TOLERANCE);
    this.points.pop();
    this.points.push(...kept);
    // A ring that comes back to its start drops the repeat.
    const a = this.points[0];
    const b = this.points[this.points.length - 1];
    if (this.points.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_RADIUS) this.points.pop();
    this.finish();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (event.key === 'Enter') this.finish();
    else if ((event.key === 'Backspace' || event.key === 'Delete') && this.points.length > 0) {
      this.points.pop();
      if (this.points.length === 0) this.cancel();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.points.length === 0) return null;
    const pts = [...this.points];
    if (this.press?.freehand) pts.push(...this.press.samples.slice(1));
    else if (this.cursorPoint) pts.push(this.cursorPoint);
    return { type: 'polygon', points: pts };
  }

  cancel(): void {
    this.points = [];
    this.cursorPoint = null;
    this.lastClick = null;
    this.press = null;
    this.chainLayerId = null;
  }

  isActive(): boolean {
    return this.points.length > 0;
  }

  private finish(): void {
    const ring = this.points;
    const layerId = this.chainLayerId;
    this.cancel();
    if (!layerId || ring.length < 3) return;
    void commitPlateau(layerId, ring);
  }
}
