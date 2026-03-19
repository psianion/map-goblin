import { Container, Graphics } from 'pixi.js';
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';

/**
 * Manages drawing tools — registration, activation, and input forwarding.
 * Renders a preview shape overlay during active drawing.
 */
export class ToolManager {
  private tools = new Map<string, DrawingTool>();
  private activeTool: DrawingTool | null = null;
  private previewGraphics: Graphics;
  private worldContainer: Container;

  constructor(worldContainer: Container) {
    this.worldContainer = worldContainer;
    this.previewGraphics = new Graphics();
    this.previewGraphics.label = 'toolPreview';
    this.worldContainer.addChild(this.previewGraphics);
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
    this.activeTool?.onPointerDown(point, event);
  }

  onPointerMove(point: Point, event: PointerEvent): void {
    const type = useStore.getState().tools.activeTool;
    if (this.activeTool?.type !== type) this.switchTool(type);
    this.activeTool?.onPointerMove(point, event);
  }

  onPointerUp(point: Point, event: PointerEvent): void {
    this.activeTool?.onPointerUp(point, event);
  }

  onKeyDown(event: KeyboardEvent): void {
    this.activeTool?.onKeyDown(event);
  }

  updatePreview(): void {
    const preview = this.activeTool?.getPreview() ?? null;
    this.renderPreview(preview);
  }

  getTool(type: string): DrawingTool | undefined {
    return this.tools.get(type);
  }

  /** Returns CSS cursor for gizmo handle hover, or null. */
  getHoverCursor(sx: number, sy: number): string | null {
    return this.activeTool?.getHoverCursor?.(sx, sy) ?? null;
  }

  /** Sync screen-space gizmo position — called every frame. */
  updateGizmo(): void {
    this.activeTool?.updateGizmo?.();
  }

  private renderPreview(preview: PreviewShape | null): void {
    this.previewGraphics.clear();
    if (!preview || preview.points.length === 0) return;

    const pts = preview.points;

    const zoom = this.worldContainer.scale.x;
    const eraseMode = useStore.getState().tools.eraseMode;
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
