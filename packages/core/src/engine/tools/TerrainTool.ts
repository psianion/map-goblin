import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { getTerrainRenderer, TERRAIN_EXTENT_HALF } from '../terrain/TerrainRenderer';
import { TerrainStrokeCommand } from '../terrain/terrainCommands';
import { drawTerrainBrushDisc } from '../terrain/terrainBrushPreview';

/** Stamp spacing along a drag, as a fraction of brush radius. */
const STAMP_SPACING = 0.35;

export class TerrainTool implements DrawingTool {
  readonly type = 'terrain' as const;
  readonly cursor = 'crosshair';

  private engine: RenderEngine;
  private brushCircle: Graphics;
  private painting = false;
  private lastStamp: Point | null = null;

  constructor(engine: RenderEngine, previewContainer: Container) {
    this.engine = engine;
    this.brushCircle = new Graphics();
    previewContainer.addChild(this.brushCircle);
  }

  private settings() {
    return useStore.getState().tools.settings.terrainBrush;
  }

  private isErase(): boolean {
    return useStore.getState().tools.eraseMode;
  }

  /**
   * Grid-snap middleware quantizes the point before it reaches the tool —
   * terrible for painting. Recompute the raw world position from the event.
   */
  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    const renderer = getTerrainRenderer();
    if (!renderer) return;
    const p = this.rawWorld(point, event);
    this.painting = true;
    this.lastStamp = p;
    renderer.beginStroke();
    const s = this.settings();
    renderer.paintStamp(p.x, p.y, s.radius, s.strength, s.slot, this.isErase());
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const p = this.rawWorld(point, event);
    this.drawBrushPreview(p);

    if (!this.painting || !this.lastStamp) return;
    const renderer = getTerrainRenderer();
    if (!renderer) return;

    const s = this.settings();
    const spacing = Math.max(0.05, s.radius * STAMP_SPACING);
    let dx = p.x - this.lastStamp.x;
    let dy = p.y - this.lastStamp.y;
    let dist = Math.hypot(dx, dy);
    // Interpolate stamps along the drag segment for a continuous stroke
    while (dist >= spacing) {
      const t = spacing / dist;
      this.lastStamp = {
        x: this.lastStamp.x + dx * t,
        y: this.lastStamp.y + dy * t,
      };
      renderer.paintStamp(this.lastStamp.x, this.lastStamp.y, s.radius, s.strength, s.slot, this.isErase());
      dx = p.x - this.lastStamp.x;
      dy = p.y - this.lastStamp.y;
      dist = Math.hypot(dx, dy);
    }
  }

  onPointerUp(): void {
    if (!this.painting) return;
    this.painting = false;
    this.lastStamp = null;
    const renderer = getTerrainRenderer();
    if (!renderer) return;
    const snapshots = renderer.endStroke();
    if (snapshots.length > 0) {
      undoManager.execute(new TerrainStrokeCommand(snapshots));
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    }
  }

  private drawBrushPreview(p: Point): void {
    const s = this.settings();
    const zoom = this.engine.stage().scale.x;
    const erase = this.isErase();
    const outOfBounds =
      Math.abs(p.x) > TERRAIN_EXTENT_HALF || Math.abs(p.y) > TERRAIN_EXTENT_HALF;

    this.brushCircle.clear();
    // Ghosted so the map still reads through it, but solid enough that the size
    // is legible — a 6% flat disc was invisible on anything but white.
    drawTerrainBrushDisc(
      this.brushCircle,
      p.x,
      p.y,
      s.radius,
      s.slot,
      erase,
      0.5,
      1.5 / zoom,
      outOfBounds ? 0x888888 : undefined,
    );
  }

  getPreview(): PreviewShape | null {
    return null; // brush circle managed directly
  }

  cancel(): void {
    if (this.painting) {
      getTerrainRenderer()?.cancelStroke();
      this.painting = false;
      this.lastStamp = null;
    }
    this.brushCircle.clear();
  }

  isActive(): boolean {
    return this.painting;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }

  destroy(): void {
    this.brushCircle.destroy();
  }
}
