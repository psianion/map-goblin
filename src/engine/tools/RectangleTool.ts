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

    const isErase = store.tools.eraseMode;

    if (isErase) {
      // Erase: remove all shapes whose points are entirely inside the rectangle
      // by issuing RemoveChildCommand for each intersecting shape child.
      const shapesToRemove = activeLayer.children.filter((c) => {
        if (c.childType !== 'shape') return false;
        const merged = clipper2Engine.intersection([c.points as [number, number][]], [rectPoly]);
        return merged.length > 0;
      });

      if (shapesToRemove.length === 0) return;

      const commands = shapesToRemove.map(
        (c) => new RemoveChildCommand('Erase rectangle', activeLayerId, c.id),
      );
      undoManager.execute(
        commands.length === 1
          ? commands[0]
          : new CompositeCommand('Erase rectangle', commands),
      );
    } else {
      const lastTextured = [...activeLayer.children]
        .reverse()
        .find((c): c is ShapeChild => c.childType === 'shape' && !!c.textureId) as ShapeChild | undefined;

      const child: ShapeChild = {
        id: crypto.randomUUID(),
        name: `Rectangle ${countShapesOfType(activeLayer, 'rectangle') + 1}`,
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        points: rectPoly,
        roughnessEnabled: store.tools.roughMode,
        roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
        textureId: activeLayer.style.defaultTextureId ?? lastTextured?.textureId,
        textureScale: lastTextured?.textureScale ?? 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: lastTextured?.textureTint ?? '#ffffff',
      };

      undoManager.execute(new AddChildCommand('Draw rectangle', activeLayerId, child));
    }
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
