import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';
import { computeMapFrame, type WorldBounds } from '../../shared/mapBounds';

/**
 * Renders the background grid in world space.
 *
 * One look, no options: dots everywhere, upgraded to lines inside the map's
 * frame rectangle (computeMapFrame) once anything is drawn. The frame is the
 * same rectangle the player fog covers, so "lines" always means "the map" and
 * "dots" always means "the void" — in the editor and at the table alike.
 *
 * Positioned inside worldContainer so the grid automatically tracks camera
 * pan. Only redraws when zoom level changes enough to alter the visible cell
 * range, or when grid config / map geometry changes (dirty flag).
 */
export class GridRenderer {
  readonly container: Container;
  private graphics: Graphics;
  private _dirty = true;

  // Track last-rendered visible range to detect when a redraw is needed
  private lastMinX = 0;
  private lastMaxX = 0;
  private lastMinY = 0;
  private lastMaxY = 0;

  constructor() {
    this.container = new Container();
    this.container.label = 'gridRenderer';
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  markDirty(): void {
    this._dirty = true;
  }

  update(engine: RenderEngine): void {
    const state = useStore.getState();
    const grid = state.grid;

    // Sync container visibility
    this.container.visible = grid.visible;
    if (!grid.visible) return;

    // Compute world-space visible bounds from screen corners
    const vp = engine.viewport();
    const tl = engine.screenToWorld(0, 0);
    const br = engine.screenToWorld(vp.width, vp.height);

    const pad = 2; // cells of padding beyond the visible edge
    const minX = Math.floor(tl.x) - pad;
    const maxX = Math.ceil(br.x) + pad;
    const minY = Math.floor(tl.y) - pad;
    const maxY = Math.ceil(br.y) + pad;

    // Skip if dirty flag unset AND visible range hasn't shifted by a full cell
    if (
      !this._dirty &&
      Math.abs(minX - this.lastMinX) < 1 &&
      Math.abs(maxX - this.lastMaxX) < 1 &&
      Math.abs(minY - this.lastMinY) < 1 &&
      Math.abs(maxY - this.lastMaxY) < 1
    ) {
      return;
    }

    this.lastMinX = minX;
    this.lastMaxX = maxX;
    this.lastMinY = minY;
    this.lastMaxY = maxY;
    this._dirty = false;

    // Compute line width in world units for ~1 screen pixel
    const zoomPx = engine.worldToScreen(1, 0).x - engine.worldToScreen(0, 0).x;
    const lineWidth = Math.max(0.01, 0.8 / Math.max(1, zoomPx));

    const frame = computeMapFrame(state.layers, state.mapSettings.terrain?.bounds ?? null);

    this.graphics.clear();
    this.drawDots(minX, maxX, minY, maxY, zoomPx, frame);
    if (frame) this.drawLines(frame, minX, maxX, minY, maxY, lineWidth);
  }

  /** Line grid clipped to the map frame (frame coords are whole cells already). */
  private drawLines(
    frame: WorldBounds,
    minX: number, maxX: number,
    minY: number, maxY: number,
    lineWidth: number,
  ): void {
    const x0 = Math.max(frame.minX, minX);
    const x1 = Math.min(frame.maxX, maxX);
    const y0 = Math.max(frame.minY, minY);
    const y1 = Math.min(frame.maxY, maxY);
    if (x0 > x1 || y0 > y1) return;

    this.graphics.setStrokeStyle({ color: 0x888888, width: lineWidth, alpha: 0.4 });

    // Vertical lines — spanning the frame, clipped to the visible range
    for (let x = x0; x <= x1; x++) {
      this.graphics.moveTo(x, y0);
      this.graphics.lineTo(x, y1);
    }
    // Horizontal lines
    for (let y = y0; y <= y1; y++) {
      this.graphics.moveTo(x0, y);
      this.graphics.lineTo(x1, y);
    }
    this.graphics.stroke();
  }

  private drawDots(
    minX: number, maxX: number,
    minY: number, maxY: number,
    zoomPx: number,
    frame: WorldBounds | null,
  ): void {
    // Dot radius: ~1.5 screen pixels in world units
    const dotR = Math.max(0.02, 1.5 / Math.max(1, zoomPx));

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        // Inside the frame the lines take over — a dot under a line crossing is mud
        if (frame && x >= frame.minX && x <= frame.maxX && y >= frame.minY && y <= frame.maxY) {
          continue;
        }
        this.graphics.circle(x, y, dotR);
      }
    }
    this.graphics.fill({ color: 0x888888, alpha: 0.45 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
