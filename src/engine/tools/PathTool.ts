import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { AddChildCommand, RemoveChildCommand, CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '@/store/types';

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

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

    const isErase = store.tools.eraseMode;

    if (isErase) {
      const shapesToRemove = activeLayer.children.filter((c) => {
        if (c.childType !== 'shape') return false;
        for (const inflatedPoly of inflated) {
          const merged = clipper2Engine.intersection(
            [c.points as [number, number][]],
            [inflatedPoly as [number, number][]],
          );
          if (merged.length > 0) return true;
        }
        return false;
      });

      if (shapesToRemove.length === 0) return;

      const commands = shapesToRemove.map(
        (c) => new RemoveChildCommand('Erase path', activeLayerId, c.id),
      );
      undoManager.execute(
        commands.length === 1
          ? commands[0]
          : new CompositeCommand('Erase path', commands),
      );
    } else {
      const lastTextured = [...activeLayer.children]
        .reverse()
        .find((c): c is ShapeChild => c.childType === 'shape' && !!c.textureId) as ShapeChild | undefined;

      const child: ShapeChild = {
        id: crypto.randomUUID(),
        name: `Path ${countShapesOfType(activeLayer, 'path') + 1}`,
        childType: 'shape',
        visible: true,
        shapeType: 'path',
        points: pathPoints,
        roughnessEnabled: store.tools.roughMode,
        roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
        textureId: activeLayer.style.defaultTextureId ?? lastTextured?.textureId,
        textureScale: lastTextured?.textureScale ?? 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: lastTextured?.textureTint ?? '#ffffff',
      };

      undoManager.execute(new AddChildCommand('Draw path', activeLayerId, child));
    }
  }
}
