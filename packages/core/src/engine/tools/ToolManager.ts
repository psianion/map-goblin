import { Container, Graphics } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { blockedLayerReason, noEditableLayerMessage } from './layerGuard';

/** Tools that ignore the erase toggle: they add a room, never cut one. */
const ALWAYS_DRAWS = new Set<string>(['roomRect', 'roomPolygon', 'divide']);

/**
 * Manages drawing tools — registration, activation, and input forwarding.
 * Renders a preview shape overlay during active drawing.
 */
export class ToolManager {
  private tools = new Map<string, DrawingTool>();
  private activeTool: DrawingTool | null = null;
  private previewGraphics: Graphics;
  private worldContainer: Container;
  private overlay: Container | null;

  /**
   * `overlay` (the engine's screen-space layer): when given, the preview is drawn there, posed
   * under the camera, on top of everything in it — above the lighting composite and the light
   * and prop overlays, so a marquee is never dimmed by the dark or hidden under a light's rings.
   */
  constructor(worldContainer: Container, overlay: Container | null = null) {
    this.worldContainer = worldContainer;
    this.overlay = overlay;
    this.previewGraphics = new Graphics();
    this.previewGraphics.label = 'toolPreview';
    (overlay ?? this.worldContainer).addChild(this.previewGraphics);
  }

  registerTool(tool: DrawingTool): void {
    this.tools.set(tool.type, tool);
  }

  switchTool(type: string): void {
    this.activeTool?.cancel();
    this.activeTool = this.tools.get(type) ?? null;
  }

  onPointerDown(point: Point, event: PointerEvent): void {
    const type = useStore.getState().tools.activeTool;
    if (this.activeTool?.type !== type) this.switchTool(type);
    if (this.activeTool?.editsActiveLayer && !this.canEditActiveLayer()) return;
    this.activeTool?.onPointerDown(point, event);
  }

  /**
   * Chain tools (wall/polygon/path) can't start or extend a chain without a
   * pointerDown, so gating this one call covers their commit paths too.
   */
  private canEditActiveLayer(): boolean {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
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

  onPointerMove(point: Point, event: PointerEvent): void {
    const type = useStore.getState().tools.activeTool;
    if (this.activeTool?.type !== type) this.switchTool(type);
    this.activeTool?.onPointerMove(point, event);
  }

  onPointerUp(point: Point, event: PointerEvent): void {
    this.activeTool?.onPointerUp(point, event);
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

  /** Whether the active tool answers this key itself, ahead of the global shortcuts. */
  ownsKey(e: KeyboardEvent): boolean {
    return this.activeTool?.ownsKey?.(e) ?? false;
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
