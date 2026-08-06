import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { eraseShapeCommands } from './eraseShapes';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';

function generateRegularPolygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

export class RegularPolygonTool implements DrawingTool {
  readonly type = 'regularPolygon' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private center: Point | null = null;
  private currentPoint: Point | null = null;
  private drawing = false;
  /**
   * The active layer when the drag started — see RectangleTool/WallTool for
   * why release re-reading the live active layer is not safe.
   */
  private startLayerId: string | null = null;

  onPointerDown(point: Point): void {
    this.center = point;
    this.currentPoint = point;
    this.drawing = true;
    this.startLayerId = useStore.getState().ui.activeLayerId;
  }

  onPointerMove(point: Point): void {
    if (!this.drawing) return;
    this.currentPoint = point;
  }

  onPointerUp(point: Point): void {
    if (!this.drawing || !this.center) return;
    this.drawing = false;

    const center = this.center;
    this.center = null;
    this.currentPoint = null;
    const activeLayerId = this.startLayerId;
    this.startLayerId = null;

    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 0.01) return;
    if (!activeLayerId) return;

    // Validated against the layer the drag started on — see RectangleTool.
    const activeLayer = resolveEditableLayer(activeLayerId);
    if (!activeLayer) return;

    const store = useStore.getState();
    const sides = store.tools.settings.regularPolygon.sides;
    const polyPoints = generateRegularPolygon(center.x, center.y, radius, sides);
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
        name: `Regular Polygon ${countShapesOfType(activeLayer, 'regularPolygon') + 1}`,
        childType: 'shape',
        visible: true,
        shapeType: 'regularPolygon',
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

      undoManager.execute(new AddChildCommand('Draw regular polygon', activeLayerId, child));
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.drawing || !this.center || !this.currentPoint) return null;
    const dx = this.currentPoint.x - this.center.x;
    const dy = this.currentPoint.y - this.center.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 0.01) return null;

    const sides = useStore.getState().tools.settings.regularPolygon.sides;
    const pts = generateRegularPolygon(this.center.x, this.center.y, radius, sides);
    return {
      type: 'polygon',
      points: pts.map(([x, y]) => ({ x, y })),
    };
  }

  cancel(): void {
    this.center = null;
    this.currentPoint = null;
    this.drawing = false;
    this.startLayerId = null;
  }

  isActive(): boolean {
    return this.drawing;
  }
}
