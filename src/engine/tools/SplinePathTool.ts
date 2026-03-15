import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { CreatePathCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { interpolateCatmullRom } from '@/geometry/catmullRom';
import type { DungeonLayer, SplinePathRecord } from '@/store/types';

type SplineState = 'idle' | 'placing' | 'adjusting';

const HIT_RADIUS_FRACTION = 0.3; // fraction of grid cell for control point hit-test

export class SplinePathTool implements DrawingTool {
  readonly type = 'splinePath' as const;
  private state: SplineState = 'idle';
  private controlPoints: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClickTime = 0;
  private dragIndex: number = -1;
  private dragging = false;

  onPointerDown(point: Point): void {
    const now = Date.now();

    if (this.state === 'idle' || this.state === 'placing') {
      // Check for double-click to transition
      if (this.state === 'placing' && this.controlPoints.length >= 2 && now - this.lastClickTime < 300) {
        this.lastClickTime = 0;
        this.transitionToAdjusting();
        return;
      }

      this.lastClickTime = now;

      if (this.state === 'idle') {
        this.state = 'placing';
        this.controlPoints = [point];
      } else {
        this.controlPoints.push(point);
      }
      this.currentPoint = point;

    } else if (this.state === 'adjusting') {
      // Check for double-click to commit
      if (now - this.lastClickTime < 300) {
        this.lastClickTime = 0;
        this.commit();
        return;
      }
      this.lastClickTime = now;

      // Hit-test existing control points for drag
      const hitIdx = this.hitTestControlPoint(point);
      if (hitIdx >= 0) {
        this.dragIndex = hitIdx;
        this.dragging = true;
      }
    }
  }

  onPointerMove(point: Point): void {
    this.currentPoint = point;

    if (this.state === 'adjusting' && this.dragging && this.dragIndex >= 0) {
      this.controlPoints[this.dragIndex] = point;
    }
  }

  onPointerUp(): void {
    if (this.state === 'adjusting' && this.dragging) {
      this.dragging = false;
      this.dragIndex = -1;
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter') {
      if (this.state === 'placing' && this.controlPoints.length >= 2) {
        this.transitionToAdjusting();
      } else if (this.state === 'adjusting') {
        this.commit();
      }
    }
  }

  getPreview(): PreviewShape | null {
    if (this.controlPoints.length === 0) return null;

    const ctrlTuples: [number, number][] = this.controlPoints.map((p) => [p.x, p.y]);

    // In placing mode, include tentative cursor point
    if (this.state === 'placing' && this.currentPoint) {
      ctrlTuples.push([this.currentPoint.x, this.currentPoint.y]);
    }

    if (ctrlTuples.length < 2) {
      // Single point — show as circle marker
      return {
        type: 'circle',
        points: [this.controlPoints[0]],
      };
    }

    // Interpolate spline for preview
    const interpolated = interpolateCatmullRom(ctrlTuples, 12);
    const previewPoints: Point[] = interpolated.map(([x, y]) => ({ x, y }));

    return {
      type: 'line',
      points: previewPoints,
    };
  }

  cancel(): void {
    this.state = 'idle';
    this.controlPoints = [];
    this.currentPoint = null;
    this.lastClickTime = 0;
    this.dragIndex = -1;
    this.dragging = false;
  }

  isActive(): boolean {
    return this.state !== 'idle';
  }

  private transitionToAdjusting(): void {
    this.state = 'adjusting';
    this.dragging = false;
    this.dragIndex = -1;
  }

  private commit(): void {
    if (this.controlPoints.length < 2) {
      this.cancel();
      return;
    }

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) {
      this.cancel();
      return;
    }

    // Inherit textureId: prefer layer default, fallback to most recent textured shape
    const defaultTexId = activeLayer.style.defaultTextureId;
    const lastTexturedShape = [...activeLayer.shapes].reverse().find((s) => s.textureId);
    const inheritedTextureId = defaultTexId ?? lastTexturedShape?.textureId;

    const pathRecord: SplinePathRecord = {
      id: crypto.randomUUID(),
      controlPoints: this.controlPoints.map((p) => [p.x, p.y] as [number, number]),
      textureId: inheritedTextureId,
      textureScale: lastTexturedShape?.textureScale ?? 0.25,
      textureTint: lastTexturedShape?.textureTint ?? '#ffffff',
      edgeSoftening: false,
      edgeSofteningWidth: 0.1,
      closed: false,
    };

    undoManager.execute(new CreatePathCommand(activeLayerId, pathRecord));

    this.state = 'idle';
    this.controlPoints = [];
    this.currentPoint = null;
    this.lastClickTime = 0;
    this.dragIndex = -1;
    this.dragging = false;
  }

  private hitTestControlPoint(point: Point): number {
    const cellSize = 1; // grid cell = 1 world unit
    const hitRadius = cellSize * HIT_RADIUS_FRACTION;
    const hitRadiusSq = hitRadius * hitRadius;

    for (let i = 0; i < this.controlPoints.length; i++) {
      const cp = this.controlPoints[i];
      const dx = point.x - cp.x;
      const dy = point.y - cp.y;
      if (dx * dx + dy * dy <= hitRadiusSq) {
        return i;
      }
    }
    return -1;
  }
}
