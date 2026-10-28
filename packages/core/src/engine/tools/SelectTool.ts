import { Container, Graphics } from 'pixi.js';
import type { Point, Polygon } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { PropertyCommand, SetRoomAnchorCommand } from '../../store/commands';
import { createPropPatchCommand, type PropPatch } from '../../store/propEdits';
import { followAsset, lightsOn } from '../../store/attachedLights';
import { clipper2Engine, isClipperReady } from '../../geometry/Clipper2Engine';
import type { AnyChild, AssetChild, DungeonLayer, Room, WallSegment } from '../../store/types';
import { expandIdsForGroups, isLayerEffectivelyVisible } from '../../store/selectors';
import type { RenderEngine } from '../RenderEngine';
import { TransformGizmo, type HandleType } from './TransformGizmo';
import { OVERLAY_INK, OVERLAY_WHITE } from '../overlayPalette';
import { computeBoundingBox, resizeBox, type OrientedBox, type ResizeHandle } from './transformMath';
import {
  anchorForHandle,
  isIdentity,
  snapshotChild,
  transformChild,
  type ChildSnapshot,
  type WorldBox,
  type WorldTransform,
} from './childTransform';
import {
  pickAllLayers,
  getChildBounds,
  getWallBounds,
  boundsIntersect,
  unionChildBounds,
  pointInShape,
  pointInAsset,
  pointInLight,
  wallReach,
  wallTouchesRect,
  roomBadgeAt,
  roomPickingEnabled,
} from '../hitTest';
import { setAnchorPreview } from '../roomAnchorDrag';
import { flattenRing } from '../../shared/bezier';
import { blockedLayerReason } from './layerGuard';
import { notify } from '../../shared/notify';

// ─── State machine ────────────────────────────────────────

type SelectState = 'IDLE' | 'SELECTING' | 'SELECTED' | 'MOVING' | 'TRANSFORMING' | 'ANCHOR';

/** Pointer travel (world units) under which a badge press is a click, not a move. */
const ANCHOR_MIN_MOVE = 0.05;

/** A prop the DM locked: the map lets clicks, marquees and drags pass through it. */
const isLockedProp = (c: AnyChild): boolean => c.childType === 'asset' && !!c.locked;

const isResizeHandle = (h: HandleType): h is ResizeHandle => h !== 'move' && h !== 'rotate';

/** The pointer and keys of one gizmo drag frame. */
interface DragInput {
  sx: number;
  sy: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

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

// A shape's outline only appears once the cursor has settled on it. Shapes can
// be huge (a cave floor is one map-sized ring), so flashing the outline on
// every crossing reads as the walls flickering, not as hover feedback.
const SHAPE_HOVER_DWELL_MS = 150;

// A selected wall has no gizmo (it does not transform), so its outline is what says it
// is selected: the hover trace, heavier.
const WALL_SELECT_WHITE_WIDTH = 2;
const WALL_SELECT_INK_WIDTH = 4.5;

/**
 * The outline of a drawn wall at `reach` from its line, in world space: the line grown
 * into a band with round ends (a loop gives an outer and an inner ring). Without the
 * geometry engine, the line itself.
 */
const wallOutlineCache = new WeakMap<WallSegment, { reach: number; rings: [number, number][][] }>();

function wallOutline(wall: WallSegment, reach: number): { rings: [number, number][][]; closed: boolean } {
  if (!isClipperReady()) return { rings: [wall.points], closed: false };
  const hit = wallOutlineCache.get(wall);
  if (hit && hit.reach === reach) return { rings: hit.rings, closed: true };
  const rings = clipper2Engine.inflateOpen([wall.points], reach) as [number, number][][];
  wallOutlineCache.set(wall, { reach, rings });
  return { rings, closed: true };
}

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
  /** Outlines of the selected drawn walls, redrawn every frame with the camera. */
  private wallSelectGraphics: Graphics;
  /** Shape whose outline is currently shown (its dwell timer has fired). */
  private shapeHoverShownId: string | null = null;
  /** The child the hover outline was last drawn for: an edit to it from outside the canvas redraws it. */
  private hoverChild: AnyChild | null = null;
  /** Pending dwell timer for a shape the cursor just moved onto. */
  private shapeHoverTimer: ReturnType<typeof setTimeout> | null = null;

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
   * Children as they were when the gizmo drag began, the handle and where the
   * press landed. Re-transformed from this each frame rather than accumulated,
   * so a long drag cannot drift.
   */
  private transformSession: {
    handle: HandleType;
    /** The press, canvas px. */
    start: { x: number; y: number };
    /** The union box at the press, world units: what a multi-selection resizes. */
    box: WorldBox;
    /** A single prop or label is resized on its own axes instead. */
    oriented: OrientedBox | null;
    /** Selected props as they were at the press: what their attached lights follow. */
    hosts: Map<string, AssetChild>;
    entries: {
      layerId: string;
      childId: string;
      snap: ChildSnapshot;
      before: Partial<AnyChild>;
      /**
       * A light pulled in because it's attached to a selected prop, not selected
       * itself: the id of that prop. It keeps its place on the prop (`followAsset`)
       * and its radius; only the prop changes size.
       */
      attachedTo?: string;
    }[];
  } | null = null;
  /** Patches of the last frame, one per session entry — what gets committed on pointer up. */
  private lastPatches: Partial<AnyChild>[] | null = null;
  /**
   * A selected room's badge being dragged: its anchor follows the pointer on the
   * overlay only (`setAnchorPreview`), and one SetRoomAnchorCommand lands on release.
   */
  private anchorDrag: { layerId: string; roomId: string; from: [number, number]; to: [number, number] } | null = null;

  constructor(engine: RenderEngine) {
    this.engine = engine;
    this.overlayContainer = engine.overlay();

    this.wallSelectGraphics = new Graphics();
    this.wallSelectGraphics.label = 'selectWalls';
    this.overlayContainer.addChild(this.wallSelectGraphics);

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
          this.beginTransformSession(handle, { x: sx, y: sy });
          return;
        }
        this.gizmo.startDrag(handle, sx, sy);
        this.state = handle === 'move' ? 'MOVING' : 'TRANSFORMING';
        this.transformBaseRegion = structuredClone(store.selection.selectedRegion) ?? null;
        return;
      }
    }

    // A press on a selected room's badge drags the room's anchor. Ahead of the pick:
    // the badge sits on the room's own face, which would just reselect the room.
    if (event && roomPickingEnabled() && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const pressed = this.rawWorld(event) ?? point;
      const badge = this.selectedBadgeAt(pressed);
      if (badge) {
        // From the press, not the anchor: the badge is drawn inside the face, which can be
        // well away from the anchor, so travel is measured from where the pointer went down.
        this.anchorDrag = {
          layerId: badge.layerId,
          roomId: badge.room.id,
          from: [pressed.x, pressed.y],
          to: [pressed.x, pressed.y],
        };
        this.state = 'ANCHOR';
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
    // Drawn walls answer too: above the floors they stand on, under the doors in them.
    // A locked prop does not: the click passes through to whatever is under it.
    const hit = pickAllLayers(dungeonLayers, worldPt, { zoom: this.engine.stage().scale.x, includeLocked: false });

    if (hit) {
      // A click on a grouped child takes the whole group. Ctrl+Shift is the
      // member-only bypass — Alt is the region-cut drag and Ctrl the
      // whole-layer toggle, so neither was free. Merged groups ignore it.
      const memberOnly = !!(event?.ctrlKey && event?.shiftKey);
      const expand = (ids: string[]): string[] =>
        expandIdsForGroups(store, ids, { mergedOnly: memberOnly });

      if (memberOnly) {
        store.setSelectedIds(expand([hit.id]));
        store.setActiveLayerId(hit.layerId);
      } else if (event?.shiftKey) {
        // Shift+click: toggle membership in selectedIds
        const current = store.selection.selectedIds;
        const added = expand([hit.id]);
        const alreadySelected = current.includes(hit.id);
        store.setSelectedIds(
          alreadySelected
            ? current.filter((id) => !added.includes(id))
            : [...new Set([...current, ...added])],
        );
      } else if (event?.ctrlKey || event?.metaKey) {
        // Ctrl/Meta+click: toggle entire layer's children, its drawn walls with them
        const layer = dungeonLayers.find((l) => l.id === hit.layerId);
        if (layer) {
          const layerIds = [
            ...layer.children.map((c) => c.id),
            ...(layer.sublayerVisibility?.walls === false ? [] : (layer.standaloneWalls ?? []).map((w) => w.id)),
          ];
          const current = store.selection.selectedIds;
          const allSelected = layerIds.every((id) => current.includes(id));
          store.setSelectedIds(
            allSelected
              ? current.filter((id) => !layerIds.includes(id))
              : [...new Set([...current, ...layerIds])],
          );
        }
      } else if (!store.selection.selectedIds.includes(hit.id)) {
        // Plain click on an unselected child: select only it. A click on a
        // child already in the selection keeps the whole selection, so the
        // move below drags the group, not just the child under the cursor.
        store.setSelectedIds(expand([hit.id]));
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
        // identity transform and writes no undo entry. A drawn wall does not move with
        // the gizmo, so a press on one never drags the rest of the selection away from it;
        // nor does a room, which is a place and moves only by its badge.
        if (this.gizmo && event && hit.kind === 'child' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const canvasRect = this.engine.canvas().getBoundingClientRect();
          const sx = event.clientX - canvasRect.left;
          const sy = event.clientY - canvasRect.top;
          this.gizmo.startDrag('move', sx, sy);
          this.state = 'MOVING';
          this.beginTransformSession('move', { x: sx, y: sy });
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

    // Badge drag: the overlay moves the badge, the store waits for the release.
    if (this.state === 'ANCHOR' && this.anchorDrag) {
      this.anchorDrag.to = [point.x, point.y];
      setAnchorPreview({ layerId: this.anchorDrag.layerId, roomId: this.anchorDrag.roomId, point: [point.x, point.y] });
      return;
    }

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
      const input: DragInput = {
        sx,
        sy,
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
      };
      const delta = this.gizmo.updateDrag(sx, sy, input, gridState.snapEnabled, gridSizeScreen);
      if (delta) this.applyTransformSession(delta, input);
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
    if (this.state === 'ANCHOR') {
      this.finishAnchorDrag([point.x, point.y]);
      return;
    }

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
      if (this.state === 'ANCHOR') {
        // Abandon the badge drag: the anchor never moved in the store.
        this.anchorDrag = null;
        setAnchorPreview(null);
        this.state = 'SELECTED';
        return;
      }
      if (this.gizmo?.isDragging()) {
        this.gizmo.cancelDrag();
        // Escape abandons the gesture, so roll the live preview back rather
        // than leaving the half-dragged state committed.
        for (const e of this.transformSession?.entries ?? []) {
          useStore.getState().updateChild(e.layerId, e.childId, e.before);
        }
        this.transformSession = null;
        this.lastPatches = null;
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
    if (this.anchorDrag) {
      this.anchorDrag = null;
      setAnchorPreview(null);
    }
    const store = useStore.getState();
    store.setSelectedIds([]);
    store.setHoveredId(null);
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.destroyGizmo();
    this.hoverGraphics.clear();
    this.hoverChild = null;
    this.wallSelectGraphics.clear();
    this.shapeHoverShownId = null;
    this.clearShapeHoverTimer();
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
    // Selected walls first, whatever the gizmo does: they have none, their outline is it.
    this.drawSelectedWalls();
    this.followHoveredChild();
    // A selection can arrive from outside the canvas — the layer panel writes
    // selectedIds directly, a fresh stamp selects its child — while this tool
    // still thinks it is idle. Adopt it, or the child is selected everywhere
    // except the one place it can be transformed.
    if (this.state === 'IDLE' && !this.altDragMode) {
      if (useStore.getState().selection.selectedIds.length > 0) {
        this.state = 'SELECTED';
        if (!this.gizmo) this.createGizmo();
      }
    } else if (this.state === 'SELECTED' && !this.gizmo && !this.altDragMode && this.hasTransformableSelection()) {
      // The box went when nothing selected could be transformed (Lock all); it comes back
      // when something can again (Unlock all, then Ungroup), the selection unchanged.
      this.createGizmo();
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
      this.gizmo.update(screenBBox);
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
    // selectedIds directly). A selection with nothing transformable — doors,
    // locked props — must not keep stale chrome on screen. Mirrors
    // snapshotChild's 'none' kind; a per-frame full snapshot would re-bake shape
    // contours for nothing.
    const transformable = children.filter((c) => c.childType !== 'door' && !isLockedProp(c));
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

    // A single prop or label is boxed on its own axes: its own size about its centre,
    // turned with it, so its handles sit on its sides.
    if (only && (only.childType === 'asset' || only.childType === 'text')) {
      const zoom = this.engine.stage().scale.x;
      const c = this.engine.worldToScreen(only.position.x, only.position.y);
      const w = ownSize.w * zoom;
      const h = ownSize.h * zoom;
      this.gizmo.update({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h }, { showRotate, chip, rotation: only.rotation });
      return;
    }
    this.gizmo.update(screenBBox, { showRotate, chip, rotation: 0 });
  }

  // ─── Gizmo transform ──────────────────────────────────────────────────────

  /** Screen-space drag deltas are in pixels; children live in world units. */
  private screenToWorldScale(): number {
    const k = this.engine.stage().scale.x;
    return k === 0 ? 1 : 1 / k;
  }

  private beginTransformSession(handle: HandleType, start: { x: number; y: number } = { x: 0, y: 0 }): void {
    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && !l.locked,
    );
    const entries: NonNullable<typeof this.transformSession>['entries'] = [];
    const selected: AnyChild[] = [];
    const hosts = new Map<string, AssetChild>();
    const idSet = new Set(store.selection.selectedIds);

    for (const layer of dungeonLayers) {
      for (const child of layer.children) {
        if (!idSet.has(child.id)) continue;
        // A locked prop stays where it is, whatever else the drag carries.
        if (isLockedProp(child)) continue;
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
        if (child.childType === 'asset') hosts.set(child.id, child);
      }
    }

    // A selected prop drags its attached lights along in the same gesture and undo,
    // whatever layer they are on. Lights in the selection move on their own above.
    for (const { layerId, light } of lightsOn(store.layers, [...hosts.keys()])) {
      if (idSet.has(light.id) || !light.attachedTo) continue;
      const snap = snapshotChild(light);
      if (snap.kind !== 'radius') continue;
      entries.push({
        layerId,
        childId: light.id,
        snap,
        before: { position: snap.position } as Partial<AnyChild>,
        attachedTo: light.attachedTo,
      });
    }

    if (entries.length === 0) {
      // Everything selected sits on a locked layer, so the filter above threw
      // it all away — the drag would otherwise just do nothing, silently.
      const lockedOut = store.layers.some(
        (l) => l.type === 'dungeon' && l.locked && l.children.some((c) => idSet.has(c.id)),
      );
      if (lockedOut) notify.warning('Layer is locked');
      this.transformSession = null;
      return;
    }

    const box = unionChildBounds(selected) ?? { x: 0, y: 0, width: 0, height: 0 };
    // One prop or label alone is boxed on its own axes, so its handles resize it along them.
    const only = selected.length === 1 ? selected[0] : null;
    const oriented =
      only && (only.childType === 'asset' || only.childType === 'text')
        ? {
            cx: only.position.x,
            cy: only.position.y,
            w: only.width * only.scale,
            h: only.height * only.scale,
            angle: only.rotation,
          }
        : null;
    this.transformSession = { handle, start, box, oriented, hosts, entries };
  }

  /**
   * One frame's patch for every session entry, or null when the drag has not changed
   * anything yet. Resizes are measured from the press in world units (`resizeBox`), with
   * Alt and the snap read live; moves and turns come from the gizmo's delta.
   */
  private sessionPatches(
    delta: { translateX: number; translateY: number; rotation: number },
    input: DragInput,
  ): Partial<AnyChild>[] | null {
    const session = this.transformSession;
    if (!session) return null;
    const k = this.screenToWorldScale();
    const { handle, box, oriented } = session;
    const patches = new Map<string, Partial<AnyChild>>();

    if (isResizeHandle(handle)) {
      const grid = useStore.getState().grid;
      const snapOn = input.ctrl ? !grid.snapEnabled : grid.snapEnabled;
      const d = { x: (input.sx - session.start.x) * k, y: (input.sy - session.start.y) * k };
      const mods = { shift: input.shift, alt: input.alt };
      const step = snapOn ? 1 / grid.snapDivision : null;
      if (oriented) {
        const next = resizeBox(oriented, handle, d, mods, step);
        if (next.w === oriented.w && next.h === oriented.h && next.cx === oriented.cx && next.cy === oriented.cy) {
          return null;
        }
        for (const e of session.entries) {
          if (e.attachedTo || e.snap.kind !== 'box') continue;
          const position = { x: next.cx, y: next.cy };
          if (e.snap.uniform) {
            // A label has one size: the factor of the axis being dragged.
            const factor = handle.includes('e') || handle.includes('w') ? next.w / oriented.w : next.h / oriented.h;
            patches.set(e.childId, { position, scale: Math.max(e.snap.scale * factor, 0.01) } as Partial<AnyChild>);
          } else {
            // The size goes into width/height; a legacy `scale` is folded in.
            patches.set(e.childId, { position, width: next.w, height: next.h, scale: 1 } as Partial<AnyChild>);
          }
        }
      } else {
        const from = { cx: box.x + box.width / 2, cy: box.y + box.height / 2, w: box.width, h: box.height, angle: 0 };
        const next = resizeBox(from, handle, d, mods, step);
        // Pinned at the opposite side, or the centre with Alt, as `resizeBox` pins it.
        const anchor = input.alt ? { x: from.cx, y: from.cy } : anchorForHandle(handle, box);
        const t: WorldTransform = {
          translateX: 0,
          translateY: 0,
          scaleX: box.width > 0 ? next.w / box.width : 1,
          scaleY: box.height > 0 ? next.h / box.height : 1,
          rotation: 0,
          anchorX: anchor.x,
          anchorY: anchor.y,
        };
        if (isIdentity(t)) return null;
        for (const e of session.entries) if (!e.attachedTo) patches.set(e.childId, transformChild(e.snap, t));
      }
    } else {
      const t: WorldTransform = {
        translateX: delta.translateX * k,
        translateY: delta.translateY * k,
        scaleX: 1,
        scaleY: 1,
        rotation: delta.rotation,
        anchorX: box.x + box.width / 2,
        anchorY: box.y + box.height / 2,
      };
      if (isIdentity(t)) return null;
      for (const e of session.entries) if (!e.attachedTo) patches.set(e.childId, transformChild(e.snap, t));
    }

    // Attached lights keep their place on their prop, mirrored and stretched with it.
    for (const e of session.entries) {
      if (!e.attachedTo || e.snap.kind !== 'radius') continue;
      const host = session.hosts.get(e.attachedTo);
      if (!host) continue;
      const after = { ...host, ...patches.get(host.id) } as AssetChild;
      patches.set(e.childId, { position: followAsset(host, after, e.snap.position) } as Partial<AnyChild>);
    }
    return session.entries.map((e) => patches.get(e.childId) ?? {});
  }

  private applyTransformSession(
    delta: { translateX: number; translateY: number; rotation: number },
    input: DragInput,
  ): void {
    const session = this.transformSession;
    if (!session) return;
    const patches = this.sessionPatches(delta, input);
    // Live preview only — no undo entry per frame.
    const updateChild = useStore.getState().updateChild;
    session.entries.forEach((e, i) => updateChild(e.layerId, e.childId, patches ? patches[i] : e.before));
    this.lastPatches = patches;
  }

  private commitTransformSession(): void {
    const session = this.transformSession;
    const patches = this.lastPatches;
    this.transformSession = null;
    this.lastPatches = null;
    if (!session) return;

    // Rewind, then replay through the command so undo has a clean before/after. A
    // click that never moved just puts back what the preview overwrote.
    for (const e of session.entries) {
      useStore.getState().updateChild(e.layerId, e.childId, e.before);
    }
    if (!patches) return;

    const label = session.entries.length > 1 ? 'Transform objects' : 'Transform object';
    // One gesture, one undo entry, through the prop patch: it moves the lights attached
    // to the props (so those are left out here) and leaves a selected light to its own
    // patch. Executed separately, dragging three selected shapes took three presses to
    // put back.
    const edits: PropPatch[] = [];
    session.entries.forEach((e, i) => {
      if (!e.attachedTo) edits.push({ layerId: e.layerId, id: e.childId, before: e.before, after: patches[i] });
    });
    undoManager.execute(createPropPatchCommand(label, edits));
  }

  /** Returns CSS cursor when hovering a gizmo handle or a selected room's badge, or null. */
  getHoverCursor(sx: number, sy: number): string | null {
    if (this.state === 'ANCHOR') return 'grabbing';
    if (this.gizmo && this.state === 'SELECTED') {
      const handle = this.gizmo.hitTest(sx, sy, { bboxIsMove: this.altDragMode });
      if (handle) return this.gizmo.getCursor(handle);
    }
    if (this.state === 'SELECTED' && roomPickingEnabled() && this.selectedBadgeAt(this.engine.screenToWorld(sx, sy))) {
      return 'grab';
    }
    return null;
  }

  // ─── Room badges ──────────────────────────────────────────────────────────

  /** The unsnapped world point under a pointer event, for badge picks the grid must not shift. */
  private rawWorld(event: PointerEvent): Point | null {
    if (typeof event.clientX !== 'number') return null;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  /** A selected room whose badge is under `point`, where rooms pick at all. */
  private selectedBadgeAt(point: Point): { layerId: string; room: Room } | null {
    if (!roomPickingEnabled()) return null;
    const store = useStore.getState();
    const ids = store.selection.selectedIds;
    if (ids.length === 0) return null;
    const zoom = this.engine.stage().scale.x;
    for (let i = store.layers.length - 1; i >= 0; i--) {
      const layer = store.layers[i];
      if (layer.type !== 'dungeon' || layer.locked || !isLayerEffectivelyVisible(store, layer)) continue;
      const room = roomBadgeAt(layer, [point.x, point.y], zoom);
      if (room && ids.includes(room.id)) return { layerId: layer.id, room };
    }
    return null;
  }

  /** Release of a badge drag: one undoable anchor move, or nothing for a click. */
  private finishAnchorDrag(to: [number, number]): void {
    const drag = this.anchorDrag;
    this.anchorDrag = null;
    this.state = 'SELECTED';
    setAnchorPreview(null);
    if (!drag) return;
    if (Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) < ANCHOR_MIN_MOVE) return;
    undoManager.execute(new SetRoomAnchorCommand(drag.layerId, drag.roomId, to));
  }

  // ─── Hover highlight ──────────────────────────────────────────────────────

  /**
   * Called every pointermove (when not actively dragging).
   * Hit-tests all visible+unlocked dungeon layers and updates hoveredId + hoverGraphics.
   */
  private updateHover(worldPoint: Point): void {
    this.hoverChild = null;
    const store = useStore.getState();
    const dungeonLayers = store.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(store, l) && !l.locked,
    );
    const pt: [number, number] = [worldPoint.x, worldPoint.y];
    // Locked props answer hover, so the prop overlay can show the lock on one.
    const hit = pickAllLayers(dungeonLayers, pt, { zoom: this.engine.stage().scale.x, includeLocked: true });
    const newHoveredId = hit?.id ?? null;

    // Only update store if value changed (avoid spurious re-renders)
    if (store.selection.hoveredId !== newHoveredId) {
      store.setHoveredId(newHoveredId);
    }

    // A room's hover outline is the room overlay's (it redraws on the hovered id, never
    // per move); this graphics layer draws nothing for it, and a floor's dwell is reset.
    if (hit?.kind === 'room') {
      this.shapeHoverShownId = null;
      this.clearShapeHoverTimer();
      this.hoverGraphics.clear();
      return;
    }

    // A drawn wall outlines at once, like a prop: it is a line, not a map-sized ring.
    if (hit?.kind === 'wall') {
      this.shapeHoverShownId = null;
      this.clearShapeHoverTimer();
      const layer = dungeonLayers.find((l) => l.id === hit.layerId);
      const g = this.hoverGraphics;
      g.clear();
      if (layer) this.traceWall(g, hit.wall, wallReach(hit.wall, layer), HOVER_INK_WIDTH, HOVER_WHITE_WIDTH, 0.55, 0.9);
      return;
    }

    const child = hit?.kind === 'child' ? hit.child : null;

    // A locked prop's outline is the prop overlay's (dashed, with its lock).
    if (child && isLockedProp(child)) {
      this.shapeHoverShownId = null;
      this.clearShapeHoverTimer();
      this.hoverGraphics.clear();
      return;
    }

    // Shapes wait out the dwell before their outline shows; leaving the shape
    // (for a wall piece, prop, or void) resets the gate so re-entry waits again.
    if (child?.childType === 'shape' && this.shapeHoverShownId !== child.id) {
      this.hoverGraphics.clear();
      this.clearShapeHoverTimer();
      this.shapeHoverTimer = setTimeout(() => {
        this.shapeHoverTimer = null;
        if (useStore.getState().selection.hoveredId === child.id) {
          this.shapeHoverShownId = child.id;
          this.drawHoverHighlight(child);
        }
      }, SHAPE_HOVER_DWELL_MS);
      return;
    }
    if (child?.childType !== 'shape') this.shapeHoverShownId = null;
    this.clearShapeHoverTimer();

    this.drawHoverHighlight(child);
  }

  /**
   * Keep the hover outline on its child when the store moves it without the pointer moving:
   * the card's fields, Align, a nudge, an undo. Runs every frame, costs an id lookup, and
   * redraws only when the child object changed. A child deleted or locked loses its outline.
   */
  private followHoveredChild(): void {
    const shown = this.hoverChild;
    if (!shown) return;
    let now: AnyChild | null = null;
    for (const layer of useStore.getState().layers) {
      if (layer.type !== 'dungeon') continue;
      now = layer.children.find((c) => c.id === shown.id) ?? null;
      if (now) break;
    }
    if (now === shown) return;
    this.drawHoverHighlight(now && !isLockedProp(now) ? now : null);
  }

  private clearShapeHoverTimer(): void {
    if (this.shapeHoverTimer) {
      clearTimeout(this.shapeHoverTimer);
      this.shapeHoverTimer = null;
    }
  }

  /**
   * Outlines a drawn wall at `reach` from its line, white over ink like every canvas
   * overlay. Screen space: the overlay container is not camera-transformed.
   */
  private traceWall(
    g: Graphics,
    wall: WallSegment,
    reach: number,
    inkWidth: number,
    whiteWidth: number,
    inkAlpha: number,
    whiteAlpha: number,
  ): void {
    const { rings, closed } = wallOutline(wall, reach);
    const screen = rings
      .filter((r) => r.length >= 2)
      .map((r) => r.map(([wx, wy]) => this.engine.worldToScreen(wx, wy)));
    if (screen.length === 0) return;
    const path = (): void => {
      for (const pts of screen) {
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        if (closed) g.closePath();
      }
    };
    path();
    g.stroke({ color: OVERLAY_INK, width: inkWidth, alpha: inkAlpha });
    path();
    g.stroke({ color: OVERLAY_WHITE, width: whiteWidth, alpha: whiteAlpha });
  }

  /** Redraws the outline of every selected drawn wall; clears it when there are none. */
  private drawSelectedWalls(): void {
    const g = this.wallSelectGraphics;
    g.clear();
    const store = useStore.getState();
    const ids = store.selection.selectedIds;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    for (const layer of store.layers) {
      if (layer.type !== 'dungeon') continue;
      if (!isLayerEffectivelyVisible(store, layer) || layer.sublayerVisibility?.walls === false) continue;
      for (const wall of layer.standaloneWalls ?? []) {
        if (!idSet.has(wall.id) || wall.points.length < 2) continue;
        this.traceWall(g, wall, wallReach(wall, layer), WALL_SELECT_INK_WIDTH, WALL_SELECT_WHITE_WIDTH, 0.7, 1);
      }
    }
  }

  /**
   * Redraws the hover highlight graphics for the given child.
   * Runs in screen-space (overlay container is not camera-transformed).
   */
  private drawHoverHighlight(child: AnyChild | null): void {
    const g = this.hoverGraphics;
    g.clear();
    this.hoverChild = child;
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
    const seeUnder = store.ui.seeUnderOverhead;

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
        // them (a group move would carry everything else and silently leave the
        // trap anchor behind).
        if (child.childType === 'zone') continue;
        // Locked props pass the marquee through, as they pass clicks; so do overhead
        // ones while the DM is looking under them.
        if (isLockedProp(child)) continue;
        if (seeUnder && child.childType === 'asset' && child.overhead) continue;
        const bounds = getChildBounds(child);
        if (boundsIntersect(bounds, dragRect)) {
          collected.push(child.id);
        }
      }
      // Drawn walls by their drawn band, not their box: a marquee inside a walled room
      // must not grab the loop around it.
      if (layer.sublayerVisibility?.walls === false) continue;
      for (const wall of layer.standaloneWalls ?? []) {
        if (wall.points.length < 2) continue;
        const reach = wallReach(wall, layer);
        if (!boundsIntersect(getWallBounds(wall, reach), dragRect)) continue;
        if (wallTouchesRect(wall, dragRect, reach)) collected.push(wall.id);
      }
    }

    if (collected.length > 0) {
      // Marquee stays granular over plain groups — you drew the rect, you meant
      // what it touched. Merged groups are atomic and come along whole.
      const expanded = expandIdsForGroups(store, collected, { mergedOnly: true });
      if (event?.shiftKey) {
        const merged = [...new Set([...store.selection.selectedIds, ...expanded])];
        store.setSelectedIds(merged);
      } else {
        store.setSelectedIds(expanded);
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
    // The region was picked up before the layer was locked/hidden, or the lock
    // landed mid-drag — either way the write has to answer for it now.
    const blocked = blockedLayerReason(activeLayer);
    if (blocked) {
      notify.warning(blocked);
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
    const blocked = blockedLayerReason(activeLayer);
    if (blocked) {
      notify.warning(blocked);
      return;
    }

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

  /** Whether anything selected takes the gizmo: not a door, not a locked prop. */
  private hasTransformableSelection(): boolean {
    const store = useStore.getState();
    const layers = store.layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
    return this.resolveSelectedChildren(store.selection.selectedIds, layers).some(
      (c) => c.childType !== 'door' && !isLockedProp(c),
    );
  }

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
