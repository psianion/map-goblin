import type { Point } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { eraseShapeCommands } from './eraseShapes';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';

const CLOSE_THRESHOLD = 0.2;

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

export class PolygonTool implements DrawingTool {
  readonly type = 'polygon' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  /** The active layer when the chain started — see WallTool for why. */
  private chainLayerId: string | null = null;

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (this.vertices.length >= 3) {
      const first = this.vertices[0];
      const dx = point.x - first.x;
      const dy = point.y - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD) {
        this.finalize();
        return;
      }
    }
    if (this.vertices.length === 0) {
      this.chainLayerId = useStore.getState().ui.activeLayerId;
    }
    point = this.constrain(point, event);
    this.vertices.push(point);
    this.currentPoint = point;
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.currentPoint = this.constrain(point, event);
  }

  /** Shift constrains the pending segment to 15° multiples off the last anchor. */
  private constrain(point: Point, event?: PointerEvent): Point {
    const anchor = this.vertices[this.vertices.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : point;
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
    this.chainLayerId = null;
  }

  isActive(): boolean {
    return this.vertices.length > 0;
  }

  private finalize(): void {
    const verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;
    const activeLayerId = this.chainLayerId;
    this.chainLayerId = null;

    if (verts.length < 3 || !activeLayerId) return;

    const store = useStore.getState();
    // Validated against the layer the chain started on — see WallTool.
    const activeLayer = resolveEditableLayer(activeLayerId);
    if (!activeLayer) return;

    const polyPoints: [number, number][] = verts.map((v) => [v.x, v.y]);
    const isErase = store.tools.eraseMode;

    if (isErase) {
      const commands = eraseShapeCommands(activeLayer, activeLayerId, [polyPoints]);
      if (commands.length === 0) return;
      undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand('Erase', commands));
    } else {
      const lastTextured = [...activeLayer.children]
        .reverse()
        .find((c): c is ShapeChild => c.childType === 'shape' && !!c.textureId) as ShapeChild | undefined;

      const child: ShapeChild = {
        id: crypto.randomUUID(),
        name: `Polygon ${countShapesOfType(activeLayer, 'polygon') + 1}`,
        childType: 'shape',
        visible: true,
        shapeType: 'polygon',
        contours: [polyPoints],
        roughnessEnabled: store.tools.roughMode,
        roughnessAmplitude: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
        textureId: activeLayer.style.defaultTextureId ?? lastTextured?.textureId,
        textureScale: lastTextured?.textureScale ?? 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: lastTextured?.textureTint ?? '#ffffff',
      };

      undoManager.execute(new AddChildCommand('Draw polygon', activeLayerId, child));
    }
  }
}
