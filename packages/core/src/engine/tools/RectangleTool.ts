import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { eraseShapeCommands } from './eraseShapes';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

export class RectangleTool implements DrawingTool {
  readonly type = 'rectangle' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private drawing = false;
  /**
   * The active layer when the drag started, captured so a lock/hide/switch
   * between press and release can't smuggle a commit onto a layer the guard
   * never checked, or silently drop it. See WallTool for the same pattern.
   */
  private startLayerId: string | null = null;

  onPointerDown(point: Point): void {
    this.startPoint = point;
    this.currentPoint = point;
    this.drawing = true;
    this.startLayerId = useStore.getState().ui.activeLayerId;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    if (!this.drawing) return;
    this.currentPoint = this.constrain(point, event);
  }

  /** Shift constrains the rectangle to a square (larger axis wins). */
  private constrain(point: Point, event?: PointerEvent): Point {
    const s = this.startPoint;
    if (!event?.shiftKey || !s) return point;
    const dx = point.x - s.x;
    const dy = point.y - s.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: s.x + Math.sign(dx || 1) * side, y: s.y + Math.sign(dy || 1) * side };
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    if (!this.drawing || !this.startPoint) return;
    this.drawing = false;

    const start = this.startPoint;
    const end = this.constrain(point, event);
    this.startPoint = null;
    this.currentPoint = null;
    const activeLayerId = this.startLayerId;
    this.startLayerId = null;

    // Ignore zero-size rectangles
    if (Math.abs(end.x - start.x) < 0.01 || Math.abs(end.y - start.y) < 0.01) return;
    if (!activeLayerId) return;

    // Validated against the layer the drag started on, not whatever is active
    // now — locking it, hiding it, or switching away mid-drag must not let
    // release commit somewhere the guard never checked.
    const activeLayer = resolveEditableLayer(activeLayerId);
    if (!activeLayer) return;

    const store = useStore.getState();

    const rectPoly: [number, number][] = [
      [start.x, start.y],
      [end.x,   start.y],
      [end.x,   end.y],
      [start.x, end.y],
    ];

    const isErase = store.tools.eraseMode;

    if (isErase) {
      // Erase: boolean-difference the erase rect from each intersecting shape.
      // If the result is empty → remove shape. Otherwise → update shape's points.
      const commands = eraseShapeCommands(activeLayer, activeLayerId, [rectPoly]);
      if (commands.length === 0) return;
      undoManager.execute(
        commands.length === 1
          ? commands[0]
          : new CompositeCommand('Erase', commands),
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
        contours: [rectPoly],
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
    this.startLayerId = null;
  }

  isActive(): boolean {
    return this.drawing;
  }
}
