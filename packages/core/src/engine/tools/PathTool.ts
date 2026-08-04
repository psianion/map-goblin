import type { Point } from '../../types/geometry';
import { snapToAngle, smoothChain } from '../../geometry/drawAssist';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand, RemoveChildCommand, UpdateChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { resolveEditableLayer } from './layerGuard';

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

export class PathTool implements DrawingTool {
  readonly type = 'path' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  /** The active layer when the chain started — see WallTool for why. */
  private chainLayerId: string | null = null;

  onPointerDown(point: Point, event?: PointerEvent): void {
    const now = Date.now();
    if (this.vertices.length >= 2 && isDoubleClick(this.lastClick, point, now)) {
      this.finalize();
      this.lastClick = null;
      return;
    }
    if (this.vertices.length === 0) {
      this.chainLayerId = useStore.getState().ui.activeLayerId;
    }
    point = this.constrain(point, event);
    this.lastClick = { point, time: now };
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
      if (this.vertices.length >= 2) this.finalize();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.vertices.length === 0) return null;
    let pts = this.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (this.currentPoint) {
      pts.push({ x: this.currentPoint.x, y: this.currentPoint.y });
    }
    // Preview the same curve the commit will produce.
    if (useStore.getState().tools.curveMode) pts = smoothChain(pts);
    return { type: 'line', points: pts };
  }

  cancel(): void {
    this.vertices = [];
    this.currentPoint = null;
    this.lastClick = null;
    this.chainLayerId = null;
  }

  isActive(): boolean {
    return this.vertices.length > 0;
  }

  private finalize(): void {
    let verts = this.vertices;
    this.vertices = [];
    this.currentPoint = null;
    this.lastClick = null;
    const activeLayerId = this.chainLayerId;
    this.chainLayerId = null;

    if (verts.length < 2 || !activeLayerId) return;

    const store = useStore.getState();
    // Curve mode smooths the centerline before it is inflated into a corridor.
    if (store.tools.curveMode) verts = smoothChain(verts);
    // Validated against the layer the chain started on — see WallTool.
    const activeLayer = resolveEditableLayer(activeLayerId);
    if (!activeLayer) return;

    const pathPoints: [number, number][] = verts.map((v) => [v.x, v.y]);
    const corridorWidth = 0.5;
    const inflated = clipper2Engine.inflateOpen([pathPoints], corridorWidth / 2);

    if (inflated.length === 0) return;

    const isErase = store.tools.eraseMode;

    if (isErase) {
      const commands: import('../../store/types').Command[] = [];
      for (const c of activeLayer.children) {
        if (c.childType !== 'shape') continue;
        const shape = c as ShapeChild;
        const outerRing = shape.contours[0];
        let hasOverlap = false;
        for (const inflatedPoly of inflated) {
          const inter = clipper2Engine.intersection([outerRing], [inflatedPoly as [number, number][]]);
          if (inter.length > 0) { hasOverlap = true; break; }
        }
        if (!hasOverlap) continue;
        const existingHoles = shape.contours.slice(1);
        const remaining = clipper2Engine.difference([outerRing], [...existingHoles, ...(inflated as [number, number][][])]);
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
        name: `Path ${countShapesOfType(activeLayer, 'path') + 1}`,
        childType: 'shape',
        visible: true,
        shapeType: 'path',
        contours: inflated as [number, number][][],
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
