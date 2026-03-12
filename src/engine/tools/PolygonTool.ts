import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { DrawShapeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer } from '@/store/types';

const CLOSE_THRESHOLD = 0.2;

export class PolygonTool implements DrawingTool {
  readonly type = 'polygon' as const;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;

  onPointerDown(point: Point): void {
    if (this.vertices.length >= 3) {
      const first = this.vertices[0];
      const dx = point.x - first.x;
      const dy = point.y - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD) {
        this.finalize();
        return;
      }
    }
    this.vertices.push(point);
    this.currentPoint = point;
  }

  onPointerMove(point: Point): void {
    this.currentPoint = point;
  }

  onPointerUp(_point: Point): void {}

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter') {
      if (this.vertices.length >= 3) this.finalize();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.vertices.length === 0) return null;
    const pts = this.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (this.currentPoint) {
      pts.push({ x: this.currentPoint.x, y: this.currentPoint.y });
    }
    return { type: 'polygon', points: pts };
  }

  cancel(): void {
    this.vertices = [];
    this.currentPoint = null;
  }

  isActive(): boolean {
    return this.vertices.length > 0;
  }

  private finalize(): void {
    const verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;

    if (verts.length < 3) return;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const polyPoints: [number, number][] = verts.map((v) => [v.x, v.y]);
    const prevFloor = activeLayer.mergedFloor;
    const isErase = store.tools.eraseMode;

    const newFloor = isErase
      ? (clipper2Engine.difference(prevFloor ?? [], [polyPoints]) as [number, number][][])
      : (clipper2Engine.union(prevFloor ?? [], [polyPoints]) as [number, number][][]);

    const shapeRecord = {
      id: crypto.randomUUID(),
      type: 'polygon' as const,
      points: polyPoints,
      roughnessEnabled: store.tools.roughMode,
      roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
    };

    undoManager.execute(
      new DrawShapeCommand(
        isErase ? 'Erase polygon' : 'Draw polygon',
        activeLayerId,
        prevFloor,
        newFloor,
        isErase ? null : shapeRecord,
        isErase,
      ),
    );
  }
}
