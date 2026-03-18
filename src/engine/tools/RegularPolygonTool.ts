import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { AddChildCommand, RemoveChildCommand, UpdateChildCommand, CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '@/store/types';

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
  private center: Point | null = null;
  private currentPoint: Point | null = null;
  private drawing = false;

  onPointerDown(point: Point): void {
    this.center = point;
    this.currentPoint = point;
    this.drawing = true;
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

    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 0.01) return;

    const store = useStore.getState();
    const sides = store.tools.settings.regularPolygon.sides;
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const polyPoints = generateRegularPolygon(center.x, center.y, radius, sides);
    const isErase = store.tools.eraseMode;

    if (isErase) {
      const commands: import('@/store/types').Command[] = [];
      for (const c of activeLayer.children) {
        if (c.childType !== 'shape') continue;
        const shape = c as ShapeChild;
        const outerRing = shape.contours[0];
        const inter = clipper2Engine.intersection([outerRing], [polyPoints]);
        if (inter.length === 0) continue;
        const existingHoles = shape.contours.slice(1);
        const remaining = clipper2Engine.difference([outerRing], [...existingHoles, polyPoints]);
        if (remaining.length === 0) {
          commands.push(new RemoveChildCommand('Erase', activeLayerId, shape.id));
        } else {
          commands.push(new UpdateChildCommand('Erase', activeLayerId, shape.id,
            { contours: shape.contours } as Partial<ShapeChild>,
            { contours: remaining } as Partial<ShapeChild>));
        }
      }
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
  }

  isActive(): boolean {
    return this.drawing;
  }
}
