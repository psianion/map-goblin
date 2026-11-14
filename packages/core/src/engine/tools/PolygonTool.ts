import type { Point } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { carveFloors } from './eraseShapes';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { DEFAULT_TEXTURE_SCALE } from '../../store/types';
import { commitNewFloor, floorsOnMap } from './newFloor';
import { flattenRing, smoothRing } from '../../shared/bezier';
import { resolveEditableLayer } from './layerGuard';
import type { ShapeCommit } from './RectangleTool';

const CLOSE_THRESHOLD = 0.2;

function countShapesOfType(layer: DungeonLayer, shapeType: string): number {
  return layer.children.filter(
    (c) => c.childType === 'shape' && c.shapeType === shapeType,
  ).length;
}

export class PolygonTool implements DrawingTool {
  readonly type = 'polygon' as const;
  /** See RectangleTool: the room tool's commit, which also ignores erase mode. */
  private readonly onShape: ShapeCommit | null;

  constructor(onShape?: ShapeCommit) {
    this.onShape = onShape ?? null;
  }

  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private vertices: Point[] = [];
  private currentPoint: Point | null = null;
  /** The active layer when the chain started — see WallTool for why. */
  private chainLayerId: string | null = null;
  /** Alt held at the last pointer or key event: closing the outline then carves it. */
  private alt = false;

  onPointerDown(point: Point, event?: PointerEvent): void {
    this.alt = event?.altKey === true;
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
    if (event) this.alt = event.altKey;
    this.currentPoint = this.constrain(point, event);
  }

  /** Shift constrains the pending segment to 15° multiples off the last anchor. */
  private constrain(point: Point, event?: PointerEvent): Point {
    const anchor = this.vertices[this.vertices.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : point;
  }

  onPointerUp(_point: Point): void {}

  onKeyDown(event: KeyboardEvent): void {
    this.alt = event.altKey;
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
    // Curve mode previews the curve the floor will take.
    if (this.curved() && pts.length >= 3) {
      const ring = pts.map((p): [number, number] => [p.x, p.y]);
      return { type: 'polygon', points: flattenRing(ring, smoothRing(ring)).map(([x, y]) => ({ x, y })) };
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

  /** Curve mode reaches floors only; the room tool's outline stays straight. */
  private curved(): boolean {
    return !this.onShape && useStore.getState().tools.curveMode;
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
    const isErase = (store.tools.floorMode === 'carve' || this.alt) && !this.onShape;
    // The Edit column's Curve: the outline is smoothed through every point clicked.
    const tangents = this.curved() ? smoothRing(polyPoints) : undefined;

    if (isErase) {
      carveFloors(activeLayer, activeLayerId, [tangents ? flattenRing(polyPoints, tangents) : polyPoints]);
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
        ...(tangents ? { tangents: [tangents] } : {}),
        textureId: activeLayer.style.defaultTextureId ?? lastTextured?.textureId,
        textureScale: lastTextured?.textureScale ?? DEFAULT_TEXTURE_SCALE,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: activeLayer.style.defaultTextureTint ?? lastTextured?.textureTint ?? '#ffffff',
      };

      if (this.onShape) {
        // A room's floor stops at a sized map's edge like any other.
        const [onMap] = floorsOnMap(child);
        if (onMap) this.onShape(activeLayer, onMap);
      } else commitNewFloor('Draw polygon', activeLayerId, child);
    }
  }
}
