import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand, RemoveChildCommand } from '../../store/commands';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { notify } from '../../shared/notify';
import { pointInPolygon } from '../hitTest';

/** Min distance between collected river stroke points (world units). */
const RIVER_POINT_SPACING = 0.3;

export class WaterTool implements DrawingTool {
  readonly type = 'water' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private engine: RenderEngine;
  // river mode: freehand drag
  private dragging = false;
  private riverPoints: Point[] = [];
  // lake mode: click vertices
  private lakeVertices: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;

  constructor(engine: RenderEngine) {
    this.engine = engine;
  }

  private settings() {
    return useStore.getState().tools.settings.water;
  }

  private activeDungeonLayer(): DungeonLayer | null {
    const store = useStore.getState();
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
    );
    return layer ?? null;
  }

  /** Raw (unsnapped) world position — freehand river strokes shouldn't quantize. */
  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    const store = useStore.getState();

    if (store.tools.eraseMode) {
      this.eraseAt(point);
      return;
    }

    if (this.settings().mode === 'river') {
      this.dragging = true;
      this.riverPoints = [this.rawWorld(point, event)];
      return;
    }

    // lake mode: click vertices, double-click closes
    const now = Date.now();
    if (this.lakeVertices.length >= 3 && isDoubleClick(this.lastClick, point, now)) {
      this.finalizeLake();
      this.lastClick = null;
      return;
    }
    this.lastClick = { point, time: now };
    this.lakeVertices.push(point);
    this.currentPoint = point;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.currentPoint = point;
    if (this.dragging) {
      const p = this.rawWorld(point, event);
      const last = this.riverPoints[this.riverPoints.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= RIVER_POINT_SPACING) {
        this.riverPoints.push(p);
      }
    }
  }

  onPointerUp(): void {
    if (this.dragging) {
      this.dragging = false;
      this.finalizeRiver();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter' && this.lakeVertices.length >= 3) {
      this.finalizeLake();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.dragging && this.riverPoints.length > 0) {
      return { type: 'line', points: this.riverPoints.map((p) => ({ x: p.x, y: p.y })) };
    }
    if (this.lakeVertices.length > 0) {
      const pts = this.lakeVertices.map((p) => ({ x: p.x, y: p.y }));
      if (this.currentPoint) pts.push({ x: this.currentPoint.x, y: this.currentPoint.y });
      return { type: this.lakeVertices.length >= 3 ? 'polygon' : 'line', points: pts };
    }
    return null;
  }

  cancel(): void {
    this.dragging = false;
    this.riverPoints = [];
    this.lakeVertices = [];
    this.currentPoint = null;
    this.lastClick = null;
  }

  isActive(): boolean {
    return this.dragging || this.lakeVertices.length > 0;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }

  // ─── Finalize ───

  private makeChild(contours: [number, number][][], waterType: 'river' | 'lake', layer: DungeonLayer): WaterChild {
    const s = this.settings();
    const count = layer.children.filter((c) => c.childType === 'water').length;
    return {
      id: crypto.randomUUID(),
      name: `${waterType === 'river' ? 'River' : 'Lake'} ${count + 1}`,
      childType: 'water',
      visible: true,
      waterType,
      contours,
      textureId: s.textureId,
      tint: '#9fc8e8',
      opacity: 0.9,
      bankTextureId: s.bankTextureId,
      bankWidth: 0.5,
      flowSpeed: s.flowSpeed,
      flowAngle: 0,
    };
  }

  private finalizeRiver(): void {
    const pts = this.riverPoints;
    this.riverPoints = [];
    if (pts.length < 2) return;

    const layer = this.activeDungeonLayer();
    if (!layer) {
      notify.warning('Select a dungeon layer to draw water');
      return;
    }

    const s = this.settings();
    const path: [number, number][] = pts.map((p) => [p.x, p.y]);
    const inflated = clipper2Engine.inflateOpen([path], s.width / 2);
    if (inflated.length === 0) return;

    // River flows roughly from stroke start to stroke end
    const flowAngle = Math.atan2(
      pts[pts.length - 1].y - pts[0].y,
      pts[pts.length - 1].x - pts[0].x,
    );
    const child = this.makeChild(inflated as [number, number][][], 'river', layer);
    child.flowAngle = flowAngle;
    undoManager.execute(new AddChildCommand('Draw river', layer.id, child));
  }

  private finalizeLake(): void {
    const verts = this.lakeVertices;
    this.lakeVertices = [];
    this.currentPoint = null;
    if (verts.length < 3) return;

    const layer = this.activeDungeonLayer();
    if (!layer) {
      notify.warning('Select a dungeon layer to draw water');
      return;
    }

    const contour: [number, number][] = verts.map((p) => [p.x, p.y]);
    // Normalize winding via clipper union so bank normals face the right way
    const normalized = clipper2Engine.union([contour], []);
    const contours = (normalized.length > 0 ? normalized : [contour]) as [number, number][][];
    const child = this.makeChild(contours, 'lake', layer);
    child.flowSpeed = 0; // lakes are still by default
    undoManager.execute(new AddChildCommand('Draw lake', layer.id, child));
  }

  private eraseAt(point: Point): void {
    const layer = this.activeDungeonLayer();
    if (!layer) return;
    // Topmost water body under the cursor (last in child order wins)
    const waters = layer.children.filter(
      (c): c is WaterChild => c.childType === 'water' && c.visible,
    );
    const p: [number, number] = [point.x, point.y];
    for (let i = waters.length - 1; i >= 0; i--) {
      const contours = waters[i].contours;
      if (!pointInPolygon(p, contours[0])) continue;
      // A click inside a hole lands where no water is drawn — not a hit.
      if (contours.slice(1).some((hole) => pointInPolygon(p, hole))) continue;
      undoManager.execute(new RemoveChildCommand('Remove water', layer.id, waters[i].id));
      return;
    }
  }
}
