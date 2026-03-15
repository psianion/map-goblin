import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { DrawShapeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer } from '@/store/types';

export class PathTool implements DrawingTool {
  readonly type = 'path' as const;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClickTime = 0;

  onPointerDown(point: Point): void {
    const now = Date.now();
    if (this.vertices.length >= 2 && now - this.lastClickTime < 300) {
      this.finalize();
      this.lastClickTime = 0;
      return;
    }
    this.lastClickTime = now;
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
      if (this.vertices.length >= 2) this.finalize();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.vertices.length === 0) return null;
    const pts = this.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (this.currentPoint) {
      pts.push({ x: this.currentPoint.x, y: this.currentPoint.y });
    }
    return { type: 'line', points: pts };
  }

  cancel(): void {
    this.vertices = [];
    this.currentPoint = null;
    this.lastClickTime = 0;
  }

  isActive(): boolean {
    return this.vertices.length > 0;
  }

  private finalize(): void {
    const verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;
    this.lastClickTime = 0;

    if (verts.length < 2) return;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const pathPoints: [number, number][] = verts.map((v) => [v.x, v.y]);
    const corridorWidth = 0.5;
    const inflated = clipper2Engine.inflate([pathPoints], corridorWidth / 2);

    if (inflated.length === 0) return;

    const prevFloor = activeLayer.mergedFloor;
    const isErase = store.tools.eraseMode;

    const newFloor = isErase
      ? (clipper2Engine.difference(prevFloor ?? [], inflated) as [number, number][][])
      : (clipper2Engine.union(prevFloor ?? [], inflated) as [number, number][][]);

    const lastTextured = [...activeLayer.shapes].reverse().find((s) => s.textureId);
    const shapeRecord = {
      id: crypto.randomUUID(),
      type: 'path' as const,
      points: pathPoints,
      roughnessEnabled: store.tools.roughMode,
      roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
      textureId: activeLayer.style.defaultTextureId ?? lastTextured?.textureId,
      textureScale: lastTextured?.textureScale ?? 0.25,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: lastTextured?.textureTint ?? '#ffffff',
    };

    undoManager.execute(
      new DrawShapeCommand(
        isErase ? 'Erase path' : 'Draw path',
        activeLayerId,
        prevFloor,
        newFloor,
        isErase ? null : shapeRecord,
        isErase,
      ),
    );
  }
}
