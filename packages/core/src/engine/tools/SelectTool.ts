import { Container, Graphics } from 'pixi.js';
import type { Point, Polygon } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { CompositeCommand, PropertyCommand, UpdateChildCommand } from '../../store/commands';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import type { AnyChild, DungeonLayer } from '../../store/types';
import { isLayerEffectivelyVisible } from '../../store/selectors';
import type { RenderEngine } from '../RenderEngine';
import { TransformGizmo, type HandleType } from './TransformGizmo';
import { OVERLAY_INK, OVERLAY_WHITE } from '../overlayPalette';
import { computeBoundingBox } from './transformMath';
import {
  anchorForHandle,
  isIdentity,
  snapshotChild,
  transformChild,
  type ChildSnapshot,
} from './childTransform';
import {
  hitTestAllLayers,
  getChildBounds,
  boundsIntersect,
  unionChildBounds,
  pointInShape,
  pointInAsset,
  pointInLight,
} from '../hitTest';
import { flattenRing } from '../../shared/bezier';

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
    g.fill({ color: OVERLAY_WHITE, alpha: 0.1 });

    if (holes.length > 0) {
      for (const poly of holes) {
        g.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
        g.closePath();
      }
      g.cut();
    }

    // White over an ink underlay — the viewfinder language from
    // overlayPalette.ts. A colour here vanished against same-hue art.
    const traceAll = (): void => {
      for (const poly of [...outers, ...holes]) {
        g.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
        g.closePath();
      }
    };
    traceAll();
    g.stroke({ color: OVERLAY_INK, width: 0.09, alpha: 0.7 });
    traceAll();
    g.stroke({ color: OVERLAY_WHITE, width: 0.04, alpha: 1 });
  }

  clear(): void {
    this.selectionGraphics.clear();
  }
}

// ─── Hover highlight graphics (screen-space overlay) ─────
// White-over-ink like every canvas overlay; hover is thinner and fainter than
// selection so weight, not hue, separates the two states.

const HOVER_WHITE_WIDTH = 1.25;
const HOVER_INK_WIDTH = 3;

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
  /**
   * Children as they were when the gizmo drag began, plus the point the drag
   * pivots about. Re-transformed from this each frame rather than accumulated,
   * so a long drag cannot drift.
   */
  private transformSession: {
    anchor: { x: number; y: number };
    entries: { layerId: string; childId: string; snap: ChildSnapshot; before: Partial<AnyChild> }[];
  } | null = null;
  /** Last delta applied this gesture — what gets committed on pointer up. */
  private lastTransform: import('./childTransform').WorldTransform | null = null;

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

    // If a gizmo exists (object selected), hit-test it first (screen-space).
    // Ahead of the Alt branch below: Alt on a resize handle means "grow about the
    // centre", which is what the handle is for, and only Alt *away* from the
    // gizmo starts a region cut. Testing region-cut first made Alt+handle throw
    // the selection away instead, so the gizmo's own alt modifier never ran.
    //
    // Handles only: a click inside the box that misses every handle falls
    // through to the child hit-test below, so a big selected child (a radius-6
    // light) no longer swallows every click across its bounds. The legacy
    // region overlay has no children to fall through to, so there the whole
    // box still means move.
    if (this.gizmo && this.state === 'SELECTED' && event) {
      const canvasRect = this.engine.canvas().getBoundingClientRect();
      const sx = event.clientX - canvasRect.left;
      const sy = event.clientY - canvasRect.top;
      const handle = this.gizmo.hitTest(sx, sy, { bboxIsMove: this.altDragMode });
      if (handle) {
        if (!this.altDragMode) {
          this.gizmo.startDrag(handle, sx, sy);
          this.state = handle === 'move' ? 'MOVING' : 'TRANSFORMING';
          this.beginTransformSession(handle, !!event.altKey);
          return;
        }
        this.gizmo.startDrag(handle, sx, sy);
        this.state = handle === 'move' ? 'MOVING' : 'TRANSFORMING';
        this.transformBaseRegion = structuredClone(store.selection.selectedRegion) ?? null;
        return;
      }
    }

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

    // Hit-test children across all visible, unlocked dungeon layers
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(store, l) && !l.locked,
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
      } else if (!store.selection.selectedIds.includes(hit.child.id)) {
        // Plain click on an unselected child: select only it. A click on a
        // child already in the selection keeps the whole selection, so the
        // move below drags the group, not just the child under the cursor.
        store.setSelectedIds([hit.child.id]);
        store.setActiveLayerId(hit.layerId);
      }

      // Re-read: `store` is the snapshot from before setSelectedIds, so its
      // selectedIds still holds the PREVIOUS selection. Trusting it meant the
      // first click on an object left state !== 'SELECTED' and created no
      // gizmo, and only a second click — seeing the stale count from the first —
      // brought one up.
      if (useStore.getState().selection.selectedIds.length > 0) {
        this.state = 'SELECTED';
        this.createGizmo();
        // Select-and-drag in one gesture: a plain press on a child arms a move
        // immediately. If the pointer never travels, the commit sees an
        // identity transform and writes no undo entry.
        if (this.gizmo && event && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const canvasRect = this.engine.canvas().getBoundingClientRect();
          const sx = event.clientX - canvasRect.left;
          const sy = event.clientY - canvasRect.top;
          this.gizmo.startDrag('move', sx, sy);
          this.state = 'MOVING';
          this.beginTransformSession('move', false);
        }
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
      const delta = this.gizmo.updateDrag(
        sx,
        sy,
        { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey },
        gridState.snapEnabled,
        gridSizeScreen,
      );
      if (delta) this.applyTransformSession(delta);
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

    // Object gizmo drag end
    if (
      !this.altDragMode &&
      (this.state === 'MOVING' || this.state === 'TRANSFORMING') &&
      this.gizmo?.isDragging()
    ) {
      this.gizmo.endDrag();
      this.commitTransformSession();
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
        // Escape abandons the gesture, so roll the live preview back rather
        // than leaving the half-dragged state committed.
        for (const e of this.transformSession?.entries ?? []) {
          useStore.getState().updateChild(e.layerId, e.childId, e.before);
        }
        this.transformSession = null;
        this.lastTransform = null;
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

  /** True while a handle or move drag is in flight — overlay chrome hides itself then. */
  isGizmoDragging(): boolean {
    return this.gizmo?.isDragging() ?? false;
  }

  /** Called every frame — syncs gizmo to current screen-space bbox of selected children. */
  updateGizmo(): void {
    // A selection can arrive from outside the canvas — the layer panel writes
    // selectedIds directly, a fresh stamp selects its child — while this tool
    // still thinks it is idle. Adopt it, or the child is selected everywhere
    // except the one place it can be transformed.
    if (this.state === 'IDLE' && !this.altDragMode) {
      if (useStore.getState().selection.selectedIds.length > 0) {
        this.state = 'SELECTED';
        if (!this.gizmo) this.createGizmo();
      }
    }
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
    if (selectedIds.length === 0) {
      // The mirror of the adoption above: a selection cleared from outside
      // the canvas must not leave a stale box floating over nothing.
      if (this.state === 'SELECTED') {
        this.destroyGizmo();
        this.state = 'IDLE';
      }
      return;
    }

    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon',
    );
    const children = this.resolveSelectedChildren(selectedIds, dungeonLayers);

    // Selection may change under a live gizmo (the layer panel writes
    // selectedIds directly). A selection with nothing transformable — doors —
    // must not keep stale chrome on screen. Mirrors snapshotChild's 'none'
    // kind; a per-frame full snapshot would re-bake shape contours for nothing.
    const transformable = children.filter((c) => c.childType !== 'door');
    if (transformable.length === 0) {
      this.destroyGizmo();
      return;
    }

    // Union world-space bounds, then project corners to screen
    const worldBox = unionChildBounds(transformable);
    if (!worldBox) return;
    const worldCorners: [number, number][] = [
      [worldBox.x, worldBox.y],
      [worldBox.x + worldBox.width, worldBox.y],
      [worldBox.x, worldBox.y + worldBox.height],
      [worldBox.x + worldBox.width, worldBox.y + worldBox.height],
    ];
    const screenPoints = worldCorners.map(([wx, wy]): [number, number] => {
      const sp = this.engine.worldToScreen(wx, wy);
      return [sp.x, sp.y];
    });
    const screenBBox = computeBoundingBox(screenPoints);

    // Lights have no orientation — hide the stem when nothing else is selected
    // rather than draw an affordance that does nothing.
    const showRotate = transformable.some((c) => c.childType !== 'light');
    // "4.0 × 2.5 sq · 15°" — world units are grid squares. Angle only when a
    // single oriented child is selected; a union box has no one rotation.
    const only = transformable.length === 1 ? transformable[0] : null;
    const deg =
      only && (only.childType === 'asset' || only.childType === 'text') && only.rotation !== 0
        ? ` · ${Math.round((only.rotation * 180) / Math.PI)}°`
        : '';
    // A single rotated prop reports its OWN size — the Transform panel shows
    // the same numbers, and two authoritative W×H readings for one object is
    // worse than either. The axis-aligned union stays for multi-selection,
    // where no single object size exists.
    const ownSize =
      only && (only.childType === 'asset' || only.childType === 'text')
        ? { w: only.width * only.scale, h: only.height * only.scale }
        : { w: worldBox.width, h: worldBox.height };
    const chip = `${ownSize.w.toFixed(1)} × ${ownSize.h.toFixed(1)} sq${deg}`;

    this.gizmo.update(screenBBox, 0, { showRotate, chip });
  }

  // ─── Gizmo transform ──────────────────────────────────────────────────────

  /** Screen-space drag deltas are in pixels; children live in world units. */
  private screenToWorldScale(): number {
    const k = this.engine.stage().scale.x;
    return k === 0 ? 1 : 1 / k;
  }

  private beginTransformSession(handle: HandleType, fromCenter = false): void {
    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && !l.locked,
    );
    const entries: NonNullable<typeof this.transformSession>['entries'] = [];
    const selected: AnyChild[] = [];
    const idSet = new Set(store.selection.selectedIds);

    for (const layer of dungeonLayers) {
      for (const child of layer.children) {
        if (!idSet.has(child.id)) continue;
        const snap = snapshotChild(child);
        if (snap.kind === 'none') continue;
        selected.push(child);
        // `before` mirrors the fields the patch writes, so undo restores exactly
        // what was overwritten and nothing else.
        const before =
          snap.kind === 'rings'
            ? // The child's OWN rings, not the snapshot's — those have any
              // transform already baked in, so pairing them with the transform
              // as well would apply it a second time on restore.
              ({
                contours: structuredClone((child as { contours: [number, number][][] }).contours),
                tangents: structuredClone((child as { tangents?: unknown }).tangents),
                transform: (child as { transform?: unknown }).transform,
              } as Partial<AnyChild>)
            : snap.kind === 'box'
              ? ({
                  position: snap.position,
                  rotation: snap.rotation,
                  scale: snap.scale,
                  width: snap.width,
                  height: snap.height,
                } as Partial<AnyChild>)
              : snap.kind === 'radius'
                ? ({ position: snap.position, radius: snap.radius } as Partial<AnyChild>)
                : ({} as Partial<AnyChild>);
        entries.push({ layerId: layer.id, childId: child.id, snap, before });
      }
    }

    if (entries.length === 0) {
      this.transformSession = null;
      return;
    }

    const box = unionChildBounds(selected) ?? { x: 0, y: 0, width: 0, height: 0 };
    // A resize normally pins the opposite corner. Alt pins the centre instead,
    // so the box grows away from its middle in both directions.
    const anchor = fromCenter
      ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      : anchorForHandle(handle, box);
    this.transformSession = { anchor, entries };
  }

  private applyTransformSession(delta: {
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  }): void {
    const session = this.transformSession;
    if (!session) return;
    const k = this.screenToWorldScale();
    const t = {
      translateX: delta.translateX * k,
      translateY: delta.translateY * k,
      scaleX: delta.scaleX,
      scaleY: delta.scaleY,
      rotation: delta.rotation,
      anchorX: session.anchor.x,
      anchorY: session.anchor.y,
    };
    // Live preview only — no undo entry per frame.
    const updateChild = useStore.getState().updateChild;
    for (const e of session.entries) {
      updateChild(e.layerId, e.childId, transformChild(e.snap, t));
    }
    this.lastTransform = t;
  }

  private commitTransformSession(): void {
    const session = this.transformSession;
    const t = this.lastTransform;
    this.transformSession = null;
    this.lastTransform = null;
    if (!session || !t) return;

    if (isIdentity(t)) {
      // A click that never moved: put back what the preview overwrote.
      for (const e of session.entries) {
        useStore.getState().updateChild(e.layerId, e.childId, e.before);
      }
      return;
    }

    // Rewind, then replay through the command so undo has a clean before/after.
    for (const e of session.entries) {
      useStore.getState().updateChild(e.layerId, e.childId, e.before);
    }
    const label = session.entries.length > 1 ? 'Transform objects' : 'Transform object';
    const commands = session.entries.map(
      (e) => new UpdateChildCommand(label, e.layerId, e.childId, e.before, transformChild(e.snap, t)),
    );
    // One gesture, one undo entry. Executed separately, dragging three selected
    // shapes took three presses to put back.
    undoManager.execute(
      commands.length === 1 ? commands[0] : new CompositeCommand(label, commands),
    );
  }

  /** Returns CSS cursor when hovering a gizmo handle, or null. */
  getHoverCursor(sx: number, sy: number): string | null {
    if (!this.gizmo || this.state !== 'SELECTED') return null;
    const handle = this.gizmo.hitTest(sx, sy, { bboxIsMove: this.altDragMode });
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
      (l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(store, l) && !l.locked,
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

    // Builds the child's outline path without stroking, so the same path can
    // be laid down twice — ink underlay, then white line.
    const trace = (): boolean => {
      switch (child.childType) {
        case 'shape': {
          // Transform shape outer ring to screen space, curves flattened so
          // the highlight hugs what is drawn.
          let pts = flattenRing(child.contours[0], child.tangents?.[0]);
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
          if (screenPts.length < 2) return false;
          g.moveTo(screenPts[0].x, screenPts[0].y);
          for (let i = 1; i < screenPts.length; i++) g.lineTo(screenPts[i].x, screenPts[i].y);
          g.closePath();
          return true;
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
          return true;
        }
        case 'light': {
          const center = this.engine.worldToScreen(child.position.x, child.position.y);
          const edgePt = this.engine.worldToScreen(child.position.x + 0.5, child.position.y);
          const radiusPx = edgePt.x - center.x;
          g.circle(center.x, center.y, Math.max(radiusPx, 6));
          return true;
        }
        default:
          return false;
      }
    };

    if (!trace()) return;
    g.stroke({ color: OVERLAY_INK, width: HOVER_INK_WIDTH, alpha: 0.55 });
    trace();
    g.stroke({ color: OVERLAY_WHITE, width: HOVER_WHITE_WIDTH, alpha: 0.9 });
  }

  // ─── Box-drag selection ───────────────────────────────────────────────────

  private finishBoxSelection(start: Point, end: Point, event?: PointerEvent): void {
    this.startPoint = null;
    this.currentPoint = null;

    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);

    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(store, l) && !l.locked,
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
        // Zones are prep markers owned by ZoneTool — the marquee must not grab
        // them (bakeSelectionTransform would move everything else and silently
        // leave the trap anchor behind).
        if (child.childType === 'zone') continue;
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

    // PropertyCommand snapshots mergedFloor before/after so region moves are undoable.
    undoManager.execute(
      new PropertyCommand(
        'Move region',
        { type: 'layer', layerId: activeLayerId },
        { mergedFloor: prevFloor },
        { mergedFloor: newFloor },
      ),
    );
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
    const newFloor = clipper2Engine.difference(prevFloor, region) as [number, number][][];
    // PropertyCommand snapshots mergedFloor before/after so region cuts are undoable.
    undoManager.execute(
      new PropertyCommand(
        'Cut region',
        { type: 'layer', layerId: activeLayerId },
        { mergedFloor: prevFloor },
        { mergedFloor: newFloor },
      ),
    );
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
