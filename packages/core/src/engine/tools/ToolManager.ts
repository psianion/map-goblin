import { Container, Graphics } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { blockedLayerReason, noEditableLayerMessage } from './layerGuard';
import { isLayerShown } from '../../store/selectors';
import { TERRAIN_PANEL_ID, type ShapeChild } from '../../store/types';
import { onMap, warnOffMap } from '../mapFrame';
import { eraseTargets, selectedPieceIds } from './eraseShapes';
import { fillPolygonsWithHoles } from '../floorWallRenderer';
import { pieceOutline } from '../pieceRenderer';

/** Tools that ignore the erase toggle: they add a room, never cut one. */
const ALWAYS_DRAWS = new Set<string>(['roomRect', 'roomPolygon', 'divide']);

/** The floor tools (Carve out and Alt erase) and the brush's three entries (Erase): the tools the erase wash follows. */
const FLOOR_TOOLS = new Set<string>(['rectangle', 'polygon', 'regularPolygon']);
const BRUSH_TOOLS = new Set<string>(['material', 'terrain', 'water']);
/** The erase hover's wash: red, a quarter opaque. */
const ERASE_WASH = 0xb3261e;
const ERASE_WASH_ALPHA = 0.25;

/** The ids of the selected floor pieces on the active layer. */
function selectedPiecesOfActiveLayer(): string[] {
  const state = useStore.getState();
  const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
  if (!layer || layer.type !== 'dungeon') return [];
  const ids = selectedPieceIds(layer, state.selection.selectedIds);
  return ids ? [...ids] : [];
}

/** Tools that place at the point clicked: on a sized map they place nothing past its edge. */
const POINT_TOOLS = new Set<string>(['wall', 'door', 'scatterBrush', 'light', 'text', 'zone']);

/**
 * Manages drawing tools — registration, activation, and input forwarding.
 * Renders a preview shape overlay during active drawing.
 */
export class ToolManager {
  private tools = new Map<string, DrawingTool>();
  private activeTool: DrawingTool | null = null;
  private previewGraphics: Graphics;
  private eraseWash: Graphics;
  /** The pieces the wash is drawn on now. */
  private washed: ShapeChild[] = [];
  private washByAlt = false;
  private worldContainer: Container;
  private overlay: Container | null;

  /**
   * `overlay` (the engine's screen-space layer): when given, the preview is drawn there, posed
   * under the camera, on top of everything in it — above the lighting composite and the light
   * and prop overlays, so a marquee is never dimmed by the dark or hidden under a light's rings.
   * `preview` (the world-space preview container): the erase wash is drawn there.
   */
  constructor(worldContainer: Container, overlay: Container | null = null, preview: Container | null = null) {
    this.worldContainer = worldContainer;
    this.overlay = overlay;
    this.previewGraphics = new Graphics();
    this.previewGraphics.label = 'toolPreview';
    (overlay ?? this.worldContainer).addChild(this.previewGraphics);
    // In the preview container, in world space: the wash lies on the piece it marks.
    this.eraseWash = new Graphics();
    this.eraseWash.label = 'eraseWash';
    preview?.addChild(this.eraseWash);
  }

  registerTool(tool: DrawingTool): void {
    this.tools.set(tool.type, tool);
  }

  switchTool(type: string): void {
    this.clearEraseWash();
    // Select lets go of its selection as it leaves, but a brush picked from it keeps the
    // floor pieces selected on the active layer: its erase keeps to them.
    const kept = this.activeTool?.type === 'select' && BRUSH_TOOLS.has(type) ? selectedPiecesOfActiveLayer() : [];
    this.activeTool?.cancel();
    this.activeTool = this.tools.get(type) ?? null;
    if (kept.length > 0) useStore.getState().setSelectedIds(kept);
  }

  onPointerDown(point: Point, event: PointerEvent, raw?: Point): void {
    const type = useStore.getState().tools.activeTool;
    if (this.activeTool?.type !== type) this.switchTool(type);
    if (this.activeTool?.editsActiveLayer && !this.canEditActiveLayer()) return;
    // A sized map ends at its frame: a point tool clicked past it places nothing.
    if (event.button === 0 && POINT_TOOLS.has(type) && !onMap(point.x, point.y)) {
      warnOffMap();
      return;
    }
    this.activeTool?.onPointerDown(point, event, raw);
  }

  /**
   * Chain tools (wall/polygon/path) can't start or extend a chain without a
   * pointerDown, so gating this one call covers their commit paths too.
   */
  private canEditActiveLayer(): boolean {
    const state = useStore.getState();
    let layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
    // With the Terrain row in hand a drawing tool takes the topmost layer it can draw on.
    if (state.ui.activeLayerId === TERRAIN_PANEL_ID) {
      layer = [...state.layers].reverse().find((l) => l.type === 'dungeon' && !l.locked && isLayerShown(state, l));
      if (layer) state.setActiveLayerId(layer.id);
    }
    if (!layer || layer.type !== 'dungeon') {
      notify.warning(noEditableLayerMessage());
      return false;
    }
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return false;
    }
    return true;
  }

  onPointerMove(point: Point, event: PointerEvent, raw?: Point): void {
    const type = useStore.getState().tools.activeTool;
    if (this.activeTool?.type !== type) this.switchTool(type);
    this.activeTool?.onPointerMove(point, event, raw);
    this.updateEraseWash(raw ?? point, event);
  }

  onPointerUp(point: Point, event: PointerEvent): void {
    this.activeTool?.onPointerUp(point, event);
    // The cut just made changed what is under the pointer: the next move washes again.
    this.clearEraseWash();
  }

  /**
   * While a floor tool is carving or the brush erasing, the piece the eraser would cut under
   * the pointer (or the selected pieces, which confine it) shows a red wash. Nothing over the
   * base ground alone, which is never cut.
   */
  private updateEraseWash(point: Point, event: PointerEvent): void {
    const state = useStore.getState();
    const type = state.tools.activeTool;
    const modeOn = this.eraseModeOn();
    const erasing = modeOn || ((FLOOR_TOOLS.has(type) || BRUSH_TOOLS.has(type)) && event.altKey);
    this.washByAlt = erasing && !modeOn;
    const layer = erasing ? state.layers.find((l) => l.id === state.ui.activeLayerId) : undefined;
    if (!layer || layer.type !== 'dungeon' || layer.locked) {
      this.clearEraseWash();
      return;
    }
    const targets = eraseTargets(layer, point.x, point.y, state.selection.selectedIds);
    if (targets.length === this.washed.length && targets.every((t, i) => t === this.washed[i])) return;
    this.washed = targets;
    this.eraseWash.clear();
    for (const shape of targets) fillPolygonsWithHoles(this.eraseWash, pieceOutline(shape), { color: ERASE_WASH });
    this.eraseWash.alpha = ERASE_WASH_ALPHA;
  }

  private clearEraseWash(): void {
    if (this.washed.length === 0) return;
    this.washed = [];
    this.eraseWash.clear();
  }

  /** Whether the tool in hand has its erase mode on (the toggle, not Alt). */
  private eraseModeOn(): boolean {
    const { tools } = useStore.getState();
    if (FLOOR_TOOLS.has(tools.activeTool)) return tools.floorMode === 'carve';
    return BRUSH_TOOLS.has(tools.activeTool) && tools.eraseMode;
  }

  /**
   * External hard-cancel — an OS pointercancel mid-draw (touch/stylus gesture
   * taken away) never reaches onPointerUp, so the active tool would otherwise
   * be left in a live-chain/live-drag state that the next unguarded
   * onPointerUp could commit.
   */
  cancelActive(): void {
    this.activeTool?.cancel();
  }

  /**
   * Returns true when the active tool was mid-gesture (isActive()) before
   * this key was handled — e.g. Escape cancelling an in-progress chain.
   * Callers use this to tell an Escape that consumed a live gesture from an
   * idle one, so a single Escape doesn't also fall through to view-level
   * effects (clearing solo, leaving Terrain) that belong to the idle case.
   */
  onKeyDown(event: KeyboardEvent): boolean {
    const wasActive = this.activeTool?.isActive() ?? false;
    this.activeTool?.onKeyDown(event);
    return wasActive;
  }

  /** Offer a wheel turn to the active tool; true when it took it. */
  onWheel(e: WheelEvent, world: Point): boolean {
    return this.activeTool?.onWheel?.(e, world) ?? false;
  }

  /** Offer a right-click to the active tool; true when it took it. */
  onContextMenu(world: Point, e: MouseEvent): boolean {
    return this.activeTool?.onContextMenu?.(world, e) ?? false;
  }

  updatePreview(): void {
    // Erase turned off from the keyboard or the dock: the wash goes without waiting for a pointer move.
    if (this.washed.length > 0 && !this.washByAlt && !this.eraseModeOn()) this.clearEraseWash();
    const preview = this.activeTool?.getPreview() ?? null;
    this.renderPreview(preview);
  }

  getTool(type: string): DrawingTool | undefined {
    return this.tools.get(type);
  }

  /**
   * Hands the Select tool a hook offered every move release (canvas px, the moved ids):
   * true takes the drop, so the move is put back and nothing is committed. The Layers pass
   * wires a filmstrip tile here; null removes it.
   */
  setMoveReleaseHook(fn: ((screen: { x: number; y: number }, ids: string[]) => boolean) | null): void {
    const select = this.tools.get('select') as (DrawingTool & { onMoveRelease?: typeof fn }) | undefined;
    if (select) select.onMoveRelease = fn ?? undefined;
  }

  /**
   * Hands the Select tool a hook told the pointer on every move of a move (null when it
   * ends); true back holds the live move while the pointer is over a drop target.
   */
  setMoveHoverHook(fn: ((screen: { x: number; y: number } | null, ids: string[]) => boolean | void) | null): void {
    const select = this.tools.get('select') as (DrawingTool & { onMoveHover?: typeof fn }) | undefined;
    if (select) select.onMoveHover = fn ?? undefined;
  }

  /** Active tool's live preview shape (world coords), for overlays like the dimension HUD. */
  getActivePreview(): { toolType: string; preview: PreviewShape } | null {
    const preview = this.activeTool?.getPreview();
    return this.activeTool && preview ? { toolType: this.activeTool.type, preview } : null;
  }

  /** Returns CSS cursor for gizmo handle hover, or null. */
  getHoverCursor(sx: number, sy: number): string | null {
    return this.activeTool?.getHoverCursor?.(sx, sy) ?? null;
  }

  /** CSS base cursor for the active tool (default: 'default'). */
  getCursor(): string {
    return this.activeTool?.cursor ?? 'default';
  }

  /** Sync screen-space gizmo position — called every frame. */
  updateGizmo(): void {
    this.activeTool?.updateGizmo?.();
  }

  private renderPreview(preview: PreviewShape | null): void {
    this.previewGraphics.clear();
    if (!preview || preview.points.length === 0) return;

    if (this.overlay) {
      const g = this.previewGraphics;
      // Overlays mount after the engine does; stay the topmost child as they arrive.
      if (this.overlay.children[this.overlay.children.length - 1] !== g) this.overlay.addChild(g);
      g.position.copyFrom(this.worldContainer.position);
      g.scale.copyFrom(this.worldContainer.scale);
    }

    const pts = preview.points;

    const zoom = this.worldContainer.scale.x;
    // The room tools always draw, whatever the erase toggle says, so their preview never turns red.
    const eraseMode = useStore.getState().tools.eraseMode && !ALWAYS_DRAWS.has(this.activeTool?.type ?? '');
    this.previewGraphics.setStrokeStyle({ color: eraseMode ? 0xff4444 : 0x4488ff, width: 1 / zoom });

    if (preview.type === 'circle' && pts.length >= 1) {
      this.previewGraphics.circle(pts[0].x, pts[0].y, 0.3);
      this.previewGraphics.fill({ color: 0x4488ff, alpha: 0.5 });
    } else if (pts.length >= 2) {
      this.previewGraphics.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        this.previewGraphics.lineTo(pts[i].x, pts[i].y);
      }
      if (preview.type === 'polygon') {
        this.previewGraphics.closePath();
        this.previewGraphics.fill({ color: 0x4488ff, alpha: 0.15 });
      }
      this.previewGraphics.stroke();
    }
  }

  destroy(): void {
    this.previewGraphics.destroy();
    this.eraseWash.destroy();
    // Call destroy on all tools that implement it (cleanup subscriptions, sprites, etc.)
    for (const tool of this.tools.values()) {
      if ('destroy' in tool && typeof (tool as { destroy: () => void }).destroy === 'function') {
        (tool as { destroy: () => void }).destroy();
      }
    }
    this.tools.clear();
    this.activeTool = null;
  }
}
