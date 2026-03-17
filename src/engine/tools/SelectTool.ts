import { Container, Graphics } from 'pixi.js';
import type { Point, Polygon } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { TransformGizmo } from './TransformGizmo';
import { computeBoundingBox } from './transformMath';
import {
  hitTestAllLayers,
  getChildBounds,
  boundsIntersect,
  pointInShape,
  pointInAsset,
  pointInLight,
} from '@/engine/hitTest';

// ─── State machine ────────────────────────────────────────

type SelectState = 'IDLE' | 'SELECTING' | 'SELECTED' | 'MOVING' | 'TRANSFORMING';

// ─── Legacy region-cut overlay (Alt+drag / selectedRegion) ───────────────────

class RegionOverlay {
  readonly container = new Container();
  private selectionGraphics = new Graphics();

  constructor() {
    this.container.addChild(this.selectionGraphics);
  }

  /** No-op — kept for API compatibility with registerTools.ts */
  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {}

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

    for (const poly of outers) {
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      g.closePath();
    }
    g.fill({ color: 0x4488ff, alpha: 0.15 });

    if (holes.length > 0) {
      for (const poly of holes) {
        g.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
        g.closePath();
      }
      g.cut();
    }

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

// ─── Hover highlight graphics (screen-space overlay) ─────

const HOVER_COLOR = 0x4488ff;
const HOVER_ALPHA = 0.4;
const HOVER_WIDTH = 1.5;

// ─── SelectTool ───────────────────────────────────────────

export class SelectTool implements DrawingTool {
  readonly type = 'select' as const;

  /** Legacy region overlay — still used for Alt+drag region-cut flow */
  readonly overlay = new RegionOverlay();

  private state: SelectState = 'IDLE';
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;

  private engine: RenderEngine;
  private overlayContainer: Container;

  // ── Object selection state ────────────────────────────
  /** Graphics drawn in the overlay to highlight the hovered child */
  private hoverGraphics: Graphics;

  // ── Gizmo (object selection) ──────────────────────────
  private gizmo: TransformGizmo | null = null;

  // ── Legacy region-cut state ───────────────────────────
  /** Snapshot of region at drag-start for live preview */
  private transformBaseRegion: [number, number][][] | null = null;
  /** User's exact drag rectangle — used for clean Clipper2 cuts */
  private selectionRect: [number, number][] | null = null;
  /** Whether the current drag started with Alt held (region-cut mode) */
  private altDragMode = false;

  constructor(engine: RenderEngine) {
    this.engine = engine;
    this.overlayContainer = engine.overlay();

    this.hoverGraphics = new Graphics();
    this.hoverGraphics.label = 'selectHover';
    this.overlayContainer.addChild(this.hoverGraphics);
  }

  // ─── DrawingTool interface ───────────────────────────────────────────────

  onPointerDown(point: Point, event?: PointerEvent): void {
    const store = useStore.getState();

    // Alt+drag → legacy region-cut mode
    if (event?.altKey) {
      this.altDragMode = true;
      this.state = 'SELECTING';
      this.startPoint = point;
      this.currentPoint = point;
      store.setSelectedRegion(null);
      store.setSelectedIds([]);
      this.overlay.clear();
      this.destroyGizmo();
      return;
    }
    this.altDragMode = false;

    // If a gizmo exists (object selected), hit-test it first (screen-space)
    if (this.gizmo && this.state === 'SELECTED' && event) {
      const canvasRect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - canvasRect.left;
      const sy = event.clientY - canvasRect.top;
      const handle = this.gizmo.hitTest(sx, sy);
      if (handle) {
        this.gizmo.startDrag(handle, sx, sy);
        this.state = handle === 'move' ? 'MOVING' : 'TRANSFORMING';
        return;
      }
    }

    // Hit-test children across all visible, unlocked dungeon layers
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.visible && !l.locked,
    );
    const worldPt: [number, number] = [point.x, point.y];
    const hit = hitTestAllLayers(dungeonLayers, worldPt);

    if (hit) {
      if (event?.shiftKey) {
        // Shift+click: toggle membership in selectedIds
        const current = store.selection.selectedIds;
        const alreadySelected = current.includes(hit.child.id);
        store.setSelectedIds(
          alreadySelected
            ? current.filter((id) => id !== hit.child.id)
            : [...current, hit.child.id],
        );
      } else if (event?.ctrlKey || event?.metaKey) {
        // Ctrl/Meta+click: toggle entire layer's children
        const layer = dungeonLayers.find((l) => l.id === hit.layerId);
        if (layer) {
          const layerIds = layer.children.map((c) => c.id);
          const current = store.selection.selectedIds;
          const allSelected = layerIds.every((id) => current.includes(id));
          store.setSelectedIds(
            allSelected
              ? current.filter((id) => !layerIds.includes(id))
              : [...new Set([...current, ...layerIds])],
          );
        }
      } else {
        // Plain click: select only this child
        store.setSelectedIds([hit.child.id]);
        store.setActiveLayerId(hit.layerId);
      }

      if (store.selection.selectedIds.length > 0) {
        this.state = 'SELECTED';
        this.createGizmo();
      }
      return;
    }

    // Clicked empty space → start box-drag selection
    this.state = 'SELECTING';
    this.startPoint = point;
    this.currentPoint = point;
    store.setSelectedIds([]);
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.currentPoint = point;

    // Update hover highlight every move (regardless of drag state)
    if (this.state !== 'MOVING' && this.state !== 'TRANSFORMING') {
      this.updateHover(point);
    }

    // Gizmo drag (object transform / move)
    if (!this.altDragMode && event && this.gizmo?.isDragging()) {
      const canvasRect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - canvasRect.left;
      const sy = event.clientY - canvasRect.top;
      const gridState = useStore.getState().grid;
      const gridSizeScreen = (1 / gridState.snapDivision) * this.engine.stage().scale.x;
      this.gizmo.updateDrag(
        sx,
        sy,
        { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
        gridState.snapEnabled,
        gridSizeScreen,
      );
      return;
    }

    // Legacy region-cut drag preview
    if (this.altDragMode && event && this.gizmo?.isDragging() && this.transformBaseRegion) {
      const canvasRect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - canvasRect.left;
      const sy = event.clientY - canvasRect.top;
      const gridState = useStore.getState().grid;
      const gridSizeScreen = (1 / gridState.snapDivision) * this.engine.stage().scale.x;
      const delta = this.gizmo.updateDrag(
        sx,
        sy,
        { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
        gridState.snapEnabled,
        gridSizeScreen,
      );
      if (!delta) return;
      const preview =
        this.state === 'MOVING'
          ? this.applyTranslate(this.transformBaseRegion, delta.translateX, delta.translateY)
          : this.applyFullTransform(this.transformBaseRegion, delta);
      this.overlay.drawSelection(preview);
    }
  }

  onPointerUp(point: Point, event?: PointerEvent): void {
    // Legacy region-cut transform commit
    if (
      this.altDragMode &&
      (this.state === 'MOVING' || this.state === 'TRANSFORMING') &&
      this.gizmo?.isDragging() &&
      event &&
      this.transformBaseRegion
    ) {
      const canvasRect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - canvasRect.left;
      const sy = event.clientY - canvasRect.top;
      const gridState = useStore.getState().grid;
      const gridSizeScreen = (1 / gridState.snapDivision) * this.engine.stage().scale.x;
      const delta = this.gizmo.updateDrag(
        sx,
        sy,
        { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
        gridState.snapEnabled,
        gridSizeScreen,
      );
      this.gizmo.endDrag();

      if (delta) {
        const finalRegion =
          this.state === 'MOVING'
            ? this.applyTranslate(this.transformBaseRegion, delta.translateX, delta.translateY)
            : this.applyFullTransform(this.transformBaseRegion, delta);
        this.commitRegionTransform(this.transformBaseRegion, finalRegion);
      } else {
        this.state = 'SELECTED';
      }
      this.transformBaseRegion = null;
      return;
    }

    // Object gizmo drag end (no commit needed — gizmo fires onTransformEnd)
    if (
      !this.altDragMode &&
      (this.state === 'MOVING' || this.state === 'TRANSFORMING') &&
      this.gizmo?.isDragging()
    ) {
      this.gizmo.endDrag();
      this.state = 'SELECTED';
      return;
    }

    // Finish box-drag selection
    if (this.state === 'SELECTING' && this.startPoint) {
      if (this.altDragMode) {
        this.finishRegionSelection(this.startPoint, point);
      } else {
        this.finishBoxSelection(this.startPoint, point, event);
      }
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
    this.altDragMode = false;
    const store = useStore.getState();
    store.setSelectedIds([]);
    store.setHoveredId(null);
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
    this.hoverGraphics.clear();
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  /** Called every frame — syncs gizmo to current screen-space bbox of selected children. */
  updateGizmo(): void {
    if (!this.gizmo || this.state === 'IDLE' || this.state === 'SELECTING') return;

    const store = useStore.getState();

    // Legacy region-cut path
    if (this.altDragMode) {
      const region = store.selection.selectedRegion;
      if (!region || region.length === 0) return;
      const allWorldPoints = region.flat();
      const screenPoints = allWorldPoints.map(([wx, wy]): [number, number] => {
        const sp = this.engine.worldToScreen(wx, wy);
        return [sp.x, sp.y];
      });
      const screenBBox = computeBoundingBox(screenPoints);
      this.gizmo.update(screenBBox, 0);
      return;
    }

    // Object selection path
    const { selectedIds } = store.selection;
    if (selectedIds.length === 0) return;

    const children = this.resolveSelectedChildren(selectedIds, store.layers as DungeonLayer[]);
    if (children.length === 0) return;

    // Union world-space bounds, then project corners to screen
    const worldCorners: [number, number][] = [];
    for (const child of children) {
      const b = getChildBounds(child);
      worldCorners.push(
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      );
    }
    const screenPoints = worldCorners.map(([wx, wy]): [number, number] => {
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

  // ─── Hover highlight ──────────────────────────────────────────────────────

  /**
   * Called every pointermove (when not actively dragging).
   * Hit-tests all visible+unlocked dungeon layers and updates hoveredId + hoverGraphics.
   */
  private updateHover(worldPoint: Point): void {
    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.visible && !l.locked,
    );
    const pt: [number, number] = [worldPoint.x, worldPoint.y];
    const hit = hitTestAllLayers(dungeonLayers, pt);
    const newHoveredId = hit?.child.id ?? null;

    // Only update store if value changed (avoid spurious re-renders)
    if (store.selection.hoveredId !== newHoveredId) {
      store.setHoveredId(newHoveredId);
    }

    this.drawHoverHighlight(hit?.child ?? null);
  }

  /**
   * Redraws the hover highlight graphics for the given child.
   * Runs in screen-space (overlay container is not camera-transformed).
   */
  private drawHoverHighlight(child: AnyChild | null): void {
    const g = this.hoverGraphics;
    g.clear();
    if (!child) return;

    g.setStrokeStyle({ color: HOVER_COLOR, alpha: HOVER_ALPHA, width: HOVER_WIDTH });

    switch (child.childType) {
      case 'shape': {
        // Transform shape points to screen space
        let pts = child.points;
        if (child.transform) {
          const t = child.transform;
          const cos = Math.cos(t.rotate);
          const sin = Math.sin(t.rotate);
          pts = pts.map(([px, py]): [number, number] => {
            const sx = px * t.scale[0];
            const sy = py * t.scale[1];
            return [
              cos * sx - sin * sy + t.translate[0],
              sin * sx + cos * sy + t.translate[1],
            ];
          });
        }
        const screenPts = pts.map(([wx, wy]) => this.engine.worldToScreen(wx, wy));
        if (screenPts.length < 2) return;
        g.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) g.lineTo(screenPts[i].x, screenPts[i].y);
        g.closePath();
        g.stroke();
        break;
      }
      case 'asset': {
        const halfW = (child.width * child.scale) / 2;
        const halfH = (child.height * child.scale) / 2;
        // Four corners in world space (unrotated first, then rotate)
        const corners: [number, number][] = [
          [-halfW, -halfH],
          [halfW, -halfH],
          [halfW, halfH],
          [-halfW, halfH],
        ].map(([lx, ly]): [number, number] => {
          if (child.rotation !== 0) {
            const cos = Math.cos(child.rotation);
            const sin = Math.sin(child.rotation);
            return [
              lx * cos - ly * sin + child.position.x,
              lx * sin + ly * cos + child.position.y,
            ];
          }
          return [lx + child.position.x, ly + child.position.y];
        });
        const screenPts = corners.map(([wx, wy]) => this.engine.worldToScreen(wx, wy));
        g.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) g.lineTo(screenPts[i].x, screenPts[i].y);
        g.closePath();
        g.stroke();
        break;
      }
      case 'light': {
        const center = this.engine.worldToScreen(child.position.x, child.position.y);
        const edgePt = this.engine.worldToScreen(child.position.x + 0.5, child.position.y);
        const radiusPx = edgePt.x - center.x;
        g.circle(center.x, center.y, Math.max(radiusPx, 6));
        g.stroke();
        break;
      }
    }
  }

  // ─── Box-drag selection ───────────────────────────────────────────────────

  private finishBoxSelection(start: Point, end: Point, event?: PointerEvent): void {
    this.startPoint = null;
    this.currentPoint = null;

    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);

    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.visible && !l.locked,
    );

    // Tiny drag → treat as click
    if (dx < 0.01 && dy < 0.01) {
      // Single click with no hit was handled in onPointerDown already
      this.state = 'IDLE';
      return;
    }

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const dragRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    const collected: string[] = [];
    for (const layer of dungeonLayers) {
      for (const child of layer.children) {
        if (!child.visible) continue;
        const bounds = getChildBounds(child);
        if (boundsIntersect(bounds, dragRect)) {
          collected.push(child.id);
        }
      }
    }

    if (collected.length > 0) {
      if (event?.shiftKey) {
        const merged = [...new Set([...store.selection.selectedIds, ...collected])];
        store.setSelectedIds(merged);
      } else {
        store.setSelectedIds(collected);
      }
      this.state = 'SELECTED';
      this.createGizmo();
    } else {
      store.setSelectedIds([]);
      this.state = 'IDLE';
    }
  }

  // ─── Legacy region-cut selection (Alt+drag) ───────────────────────────────

  private finishRegionSelection(start: Point, end: Point): void {
    this.startPoint = null;
    this.currentPoint = null;

    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx < 0.01 && dy < 0.01) {
      this.state = 'IDLE';
      this.altDragMode = false;
      return;
    }

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer?.mergedFloor) {
      this.state = 'IDLE';
      this.altDragMode = false;
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
      this.altDragMode = false;
      return;
    }

    store.setSelectedRegion(selectedRegion);
    this.overlay.drawSelection(selectedRegion);
    this.state = 'SELECTED';
    this.createGizmo();
  }

  // ─── Legacy region-cut transform commit ───────────────────────────────────

  private commitRegionTransform(
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
    // Use the exact user-drawn selection rect for the cut (avoids Clipper2 precision drift)
    const cutShape = this.selectionRect ? [this.selectionRect] : [baseRegion.flat()];
    const withoutSelected = clipper2Engine.difference(prevFloor, cutShape) as [number, number][][];
    const newFloor = clipper2Engine.union(withoutSelected, finalRegion) as [number, number][][];

    // TODO: wrap in a proper RegionMoveCommand for undo/redo once that command is added
    // TODO: wrap in a proper RegionMoveCommand for undo/redo once that command is added
    store.updateLayer(activeLayerId, { mergedFloor: newFloor } as Partial<DungeonLayer>);
    store.setSelectedRegion(finalRegion);
    this.overlay.drawSelection(finalRegion);
    this.state = 'SELECTED';
  }

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

    const allPoints = region.flat();
    const bbox = computeBoundingBox(allPoints);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const cos = Math.cos(delta.rotation);
    const sin = Math.sin(delta.rotation);

    return region.map((poly) =>
      poly.map(([px, py]): [number, number] => {
        const sx = cx + (px - cx) * delta.scaleX;
        const sy = cy + (py - cy) * delta.scaleY;
        const dx = sx - cx;
        const dy = sy - cy;
        const rx = cx + dx * cos - dy * sin;
        const ry = cy + dx * sin + dy * cos;
        return [rx + worldDx, ry + worldDy];
      }),
    );
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  private deleteSelection(): void {
    const store = useStore.getState();

    // Object selection: handled by Delete shortcut elsewhere; clear for now
    if (store.selection.selectedIds.length > 0) {
      store.setSelectedIds([]);
      this.destroyGizmo();
      this.state = 'IDLE';
      return;
    }

    // Legacy region-cut delete
    const region = store.selection.selectedRegion;
    if (!region) return;
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const prevFloor = activeLayer.mergedFloor ?? [];
    // TODO: wrap in a RegionCutCommand for undo/redo once that command is added
    const newFloor = clipper2Engine.difference(prevFloor, region) as [number, number][][];
    store.updateLayer(activeLayerId, { mergedFloor: newFloor } as Partial<DungeonLayer>);
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
    this.state = 'IDLE';
    this.altDragMode = false;
  }

  // ─── Gizmo lifecycle ──────────────────────────────────────────────────────

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

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Resolves selected IDs to their AnyChild objects across all dungeon layers. */
  private resolveSelectedChildren(ids: string[], layers: DungeonLayer[]): AnyChild[] {
    const result: AnyChild[] = [];
    const idSet = new Set(ids);
    for (const layer of layers) {
      for (const child of layer.children) {
        if (idSet.has(child.id)) result.push(child);
      }
    }
    return result;
  }
}

// Re-export hit test helpers for consumers that import from this module
export { pointInShape, pointInAsset, pointInLight };
