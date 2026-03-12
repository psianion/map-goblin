import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { DrawShapeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer } from '@/store/types';

export class RectangleTool implements DrawingTool {
  readonly type = 'rectangle' as const;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private drawing = false;

  onPointerDown(point: Point): void {
    this.startPoint = point;
    this.currentPoint = point;
    this.drawing = true;
  }

  onPointerMove(point: Point): void {
    if (!this.drawing) return;
    this.currentPoint = point;
  }

  onPointerUp(point: Point): void {
    if (!this.drawing || !this.startPoint) return;
    this.drawing = false;

    const start = this.startPoint;
    const end = point;
    this.startPoint = null;
    this.currentPoint = null;

    // Ignore zero-size rectangles
    if (Math.abs(end.x - start.x) < 0.01 || Math.abs(end.y - start.y) < 0.01) return;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const rectPoly: [number, number][] = [
      [start.x, start.y],
      [end.x,   start.y],
      [end.x,   end.y],
      [start.x, end.y],
    ];

    const prevFloor = activeLayer.mergedFloor;
    const isErase = store.tools.eraseMode;

    let newFloor: [number, number][][] | null;
    if (isErase) {
      // Erase: subtract rectangle from existing floor via Clipper2 boolean difference.
      // The stub implementation returns subjects unchanged — will work once Clipper2 is installed.
      newFloor = clipper2Engine.difference(prevFloor ?? [], [rectPoly]) as [number, number][][];
    } else {
      // Draw: union new rectangle into existing floor via Clipper2 boolean union
      newFloor = clipper2Engine.union(prevFloor ?? [], [rectPoly]) as [number, number][][];
    }

    const shapeRecord = {
      id: crypto.randomUUID(),
      type: 'rectangle' as const,
      points: rectPoly,
      roughnessEnabled: store.tools.roughMode,
      roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
    };

    undoManager.execute(
      new DrawShapeCommand(
        isErase ? 'Erase rectangle' : 'Draw rectangle',
        activeLayerId,
        prevFloor,
        newFloor,
        isErase ? null : shapeRecord,
        isErase,
      ),
    );
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.drawing || !this.startPoint || !this.currentPoint) return null;
    const s = this.startPoint;
    const e = this.currentPoint;
    return {
      type: 'polygon',
      points: [
        { x: s.x, y: s.y },
        { x: e.x, y: s.y },
        { x: e.x, y: e.y },
        { x: s.x, y: e.y },
      ],
    };
  }

  cancel(): void {
    this.startPoint = null;
    this.currentPoint = null;
    this.drawing = false;
  }

  isActive(): boolean {
    return this.drawing;
  }
}
