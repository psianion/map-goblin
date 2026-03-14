import { Container, Graphics } from 'pixi.js';
import type { Point, Polygon } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { SelectionMoveCommand, CutCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { TransformGizmo } from './TransformGizmo';
import { computeBoundingBox } from './transformMath';

type SelectState = 'IDLE' | 'SELECTING' | 'SELECTED' | 'MOVING' | 'TRANSFORMING';

class ToolOverlay {
  readonly container = new Container();
  private selectionGraphics = new Graphics();

  constructor() {
    this.container.addChild(this.selectionGraphics);
  }

  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {
  }

  drawSelection(region: Polygon[]): void {
    this.selectionGraphics.clear();
    if (region.length === 0) return;

    // Classify polygons by winding: positive signed area = outer, negative = hole
    const outers: Polygon[] = [];
    const holes: Polygon[] = [];
    for (const poly of region) {
      if (poly.length < 3) continue;
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        area += poly[i][0] * poly[j][1];
        area -= poly[j][0] * poly[i][1];
      }
      if (area >= 0) outers.push(poly);
      else holes.push(poly);
    }

    const g = this.selectionGraphics;

    // Fill outers
    for (const poly of outers) {
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      g.closePath();
    }
    g.fill({ color: 0x4488ff, alpha: 0.15 });

    // Cut holes
    if (holes.length > 0) {
      for (const poly of holes) {
        g.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
        g.closePath();
      }
      g.cut();
    }

    // Stroke all contours (outers + holes)
    g.setStrokeStyle({ color: 0x4488ff, width: 0.04 });
    for (const poly of [...outers, ...holes]) {
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      g.closePath();
    }
    g.stroke();
  }

  clear(): void {
    this.selectionGraphics.clear();
  }
}

export class SelectTool implements DrawingTool {
  readonly type = 'select' as const;
  readonly overlay = new ToolOverlay();

  private state: SelectState = 'IDLE';
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;

  // Engine reference (for coordinate transforms and canvas access)
  private engine: RenderEngine;

  // TransformGizmo — created when a region is selected, destroyed when cleared
  private gizmo: TransformGizmo | null = null;
  private overlayContainer: Container;

  // Snapshot of the region at drag-start (for live preview and Escape cancel)
  private transformBaseRegion: [number, number][][] | null = null;

  // The original selection rectangle (user's drag box) — used for clean cuts
  // instead of intersection-derived polygons which have Clipper2 coord mismatch.
  private selectionRect: [number, number][] | null = null;

  constructor(engine: RenderEngine) {
    this.engine = engine;
    this.overlayContainer = engine.overlay();
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    const store = useStore.getState();

    // Hit-test gizmo first (screen-space) when a selection exists
    if (this.gizmo && this.state === 'SELECTED' && event) {
      const rect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const handle = this.gizmo.hitTest(sx, sy);
      if (handle) {
        const region = store.selection.selectedRegion;
        this.transformBaseRegion = region
          ? region.map((poly) => poly.map((pt) => [...pt] as [number, number]))
          : null;
        this.gizmo.startDrag(handle, sx, sy);
        this.state = handle === 'move' ? 'MOVING' : 'TRANSFORMING';
        return;
      }
    }

    // Start a new box selection
    this.state = 'SELECTING';
    this.startPoint = point;
    this.currentPoint = point;
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.currentPoint = point;

    if (!event || !this.gizmo?.isDragging() || !this.transformBaseRegion) return;

    const rect = this.engine.canvas().getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const gridState = useStore.getState().grid;
    const gridSizeScreen = (1 / gridState.snapDivision) * this.engine.stage().scale.x;
    const delta = this.gizmo.updateDrag(
      sx, sy,
      { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
      gridState.snapEnabled,
      gridSizeScreen,
    );
    if (!delta) return;

    const preview = this.state === 'MOVING'
      ? this.applyTranslate(this.transformBaseRegion, delta.translateX, delta.translateY)
      : this.applyFullTransform(this.transformBaseRegion, delta);
    this.overlay.drawSelection(preview);
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    if ((this.state === 'MOVING' || this.state === 'TRANSFORMING') && this.gizmo?.isDragging() && event && this.transformBaseRegion) {
      const rect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const gridState = useStore.getState().grid;
      const gridSizeScreen = (1 / gridState.snapDivision) * this.engine.stage().scale.x;
      const delta = this.gizmo.updateDrag(
        sx, sy,
        { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
        gridState.snapEnabled,
        gridSizeScreen,
      );
      this.gizmo.endDrag();

      if (delta) {
        const finalRegion = this.state === 'MOVING'
          ? this.applyTranslate(this.transformBaseRegion, delta.translateX, delta.translateY)
          : this.applyFullTransform(this.transformBaseRegion, delta);
        this.commitTransform(this.transformBaseRegion, finalRegion);
      } else {
        this.state = 'SELECTED';
      }
      this.transformBaseRegion = null;
      return;
    }

    if (this.state === 'SELECTING' && this.startPoint) {
      this.finishSelection(this.startPoint, point);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.gizmo?.isDragging()) {
        this.gizmo.cancelDrag();
        if (this.transformBaseRegion) {
          this.overlay.drawSelection(this.transformBaseRegion);
        }
        this.state = 'SELECTED';
        this.transformBaseRegion = null;
        return;
      }
      this.cancel();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelection();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.state === 'SELECTING' && this.startPoint && this.currentPoint) {
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
    return null;
  }

  cancel(): void {
    this.state = 'IDLE';
    this.startPoint = null;
    this.currentPoint = null;
    this.transformBaseRegion = null;
    this.selectionRect = null;
    useStore.getState().setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  /** Called every frame — syncs gizmo to current screen-space bbox of selected region. */
  updateGizmo(): void {
    if (!this.gizmo || this.state === 'IDLE' || this.state === 'SELECTING') return;
    const region = useStore.getState().selection.selectedRegion;
    if (!region || region.length === 0) return;

    const allWorldPoints = region.flat();
    const screenPoints = allWorldPoints.map(([wx, wy]): [number, number] => {
      const sp = this.engine.worldToScreen(wx, wy);
      return [sp.x, sp.y];
    });

    const screenBBox = computeBoundingBox(screenPoints);
    this.gizmo.update(screenBBox, 0);
  }

  /** Returns CSS cursor when hovering a gizmo handle, or null. */
  getHoverCursor(sx: number, sy: number): string | null {
    if (!this.gizmo || this.state !== 'SELECTED') return null;
    const handle = this.gizmo.hitTest(sx, sy);
    return handle ? this.gizmo.getCursor(handle) : null;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private applyTranslate(
    region: [number, number][][],
    screenDx: number,
    screenDy: number,
  ): [number, number][][] {
    const zoom = this.engine.stage().scale.x;
    const worldDx = screenDx / zoom;
    const worldDy = screenDy / zoom;
    return region.map((poly) =>
      poly.map(([px, py]): [number, number] => [px + worldDx, py + worldDy]),
    );
  }

  private applyFullTransform(
    region: [number, number][][],
    delta: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: number },
  ): [number, number][][] {
    const zoom = this.engine.stage().scale.x;
    const worldDx = delta.translateX / zoom;
    const worldDy = delta.translateY / zoom;

    // Pivot: world-space center of the region bbox
    const allPoints = region.flat();
    const bbox = computeBoundingBox(allPoints);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const cos = Math.cos(delta.rotation);
    const sin = Math.sin(delta.rotation);

    return region.map((poly) =>
      poly.map(([px, py]): [number, number] => {
        // Scale around center
        const sx = cx + (px - cx) * delta.scaleX;
        const sy = cy + (py - cy) * delta.scaleY;
        // Rotate around center
        const dx = sx - cx;
        const dy = sy - cy;
        const rx = cx + dx * cos - dy * sin;
        const ry = cy + dx * sin + dy * cos;
        // Translate
        return [rx + worldDx, ry + worldDy];
      }),
    );
  }

  private commitTransform(
    baseRegion: [number, number][][],
    finalRegion: [number, number][][],
  ): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) {
      this.state = 'SELECTED';
      return;
    }

    const prevFloor = activeLayer.mergedFloor ?? [];
    // Use the original selection rectangle for the cut — NOT the intersection-
    // derived baseRegion. The selRect has exact user-drawn coordinates (snapped
    // to grid), so difference(floor, selRect) always produces clean edges.
    // The intersection-derived coords have Clipper2 precision drift that causes
    // micro-strips and healed holes.
    const cutShape = this.selectionRect ? [this.selectionRect] : [baseRegion.flat()];
    const withoutSelected = clipper2Engine.difference(prevFloor, cutShape) as [number, number][][];
    const newFloor = clipper2Engine.union(withoutSelected, finalRegion) as [number, number][][];

    undoManager.execute(
      new SelectionMoveCommand(activeLayerId, activeLayer.mergedFloor, newFloor),
    );

    store.setSelectedRegion(finalRegion);
    this.overlay.drawSelection(finalRegion);
    this.state = 'SELECTED';
  }

  private createGizmo(): void {
    this.destroyGizmo();
    this.gizmo = new TransformGizmo();
    this.overlayContainer.addChild(this.gizmo.container);
    this.updateGizmo();
  }

  private destroyGizmo(): void {
    if (this.gizmo) {
      this.gizmo.destroy();
      this.gizmo = null;
    }
  }

  private deleteSelection(): void {
    const store = useStore.getState();
    const region = store.selection.selectedRegion;
    if (!region) return;
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const prevFloor = activeLayer.mergedFloor;
    undoManager.execute(new CutCommand(activeLayerId, prevFloor, region));
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
    this.state = 'IDLE';
  }

  private finishSelection(start: Point, end: Point): void {
    this.startPoint = null;
    this.currentPoint = null;

    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx < 0.01 && dy < 0.01) {
      this.state = 'IDLE';
      return;
    }

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer?.mergedFloor) {
      this.state = 'IDLE';
      return;
    }

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    this.selectionRect = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];

    const selectedRegion = clipper2Engine.intersection(
      activeLayer.mergedFloor,
      [this.selectionRect],
    ) as [number, number][][];

    if (selectedRegion.length === 0) {
      this.selectionRect = null;
      this.state = 'IDLE';
      return;
    }

    store.setSelectedRegion(selectedRegion);
    this.overlay.drawSelection(selectedRegion);
    this.state = 'SELECTED';
    this.createGizmo();
  }
}
