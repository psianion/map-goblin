import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';

/**
 * Renders the background grid in world space: dots, everywhere, and nothing else.
 *
 * Line grid over the map itself is not drawn here — each dungeon layer draws its
 * own line grid clipped to its floor shapes (floorWallRenderer's grid sublayer),
 * so lines always mean "the built map" and dots always mean "the void", in the
 * editor and at the table alike.
 *
 * Positioned inside worldContainer so the grid automatically tracks camera pan —
 * during a pan/zoom in progress the existing dots ride along for free, no redraw.
 * Redraws are rate-limited to: grid config changes (dirty flag, immediate), the
 * view moving outside the last-drawn padded region (immediate, avoids a visible
 * gap), or the camera settling after a move (throttled — see SETTLE_MS below,
 * this is what re-derives the screen-constant dot radius after a zoom).
 */
// Cells of padding beyond the visible edge, drawn into the Graphics so pan can
// outrun the "settled" redraw without a visible gap.
const PAD = 6;
// Camera has to sit still this long before an in-progress pan/zoom earns a
// redraw (which also re-derives the screen-constant dot radius for the new
// zoom level). Chosen to be well under human-perceptible "did it just pop".
const SETTLE_MS = 120;
// Stock dots: mid grey, part transparent, so they read on any background colour.
const DEFAULT_DOT_COLOR = 0x888888;
const DEFAULT_DOT_ALPHA = 0.45;

export class GridRenderer {
  readonly container: Container;
  private graphics: Graphics;
  private _dirty = true;

  // World-space range actually drawn into `graphics` right now (includes PAD).
  private drawnMinX = 0;
  private drawnMaxX = 0;
  private drawnMinY = 0;
  private drawnMaxY = 0;
  private hasDrawn = false;

  // Frame-to-frame visible-range tracking, to detect motion and time its settle.
  private lastFrameMinX = 0;
  private lastFrameMaxX = 0;
  private lastFrameMinY = 0;
  private lastFrameMaxY = 0;
  private lastMoveTime = 0;
  private rangeChangedSinceDraw = false;

  constructor() {
    this.container = new Container();
    this.container.label = 'gridRenderer';
    this.graphics = new Graphics();
    this.graphics.tint = DEFAULT_DOT_COLOR;
    this.graphics.alpha = DEFAULT_DOT_ALPHA;
    this.container.addChild(this.graphics);
  }

  /**
   * Colour the dots, or `null` for the stock grey. A host that lays the map on a desk of
   * its own (`editorDesk`) passes its dot colour, drawn solid. Only the colour changes:
   * the grid is the same world-space grid either way.
   */
  setDotColor(color: number | null): void {
    this.graphics.tint = color ?? DEFAULT_DOT_COLOR;
    this.graphics.alpha = color === null ? DEFAULT_DOT_ALPHA : 1;
  }

  markDirty(): void {
    this._dirty = true;
  }

  update(engine: RenderEngine): void {
    const grid = useStore.getState().grid;

    // Sync container visibility
    this.container.visible = grid.visible;
    if (!grid.visible) return;

    // Compute world-space visible bounds from screen corners (unpadded — the
    // actual on-screen range this frame).
    const vp = engine.viewport();
    const tl = engine.screenToWorld(0, 0);
    const br = engine.screenToWorld(vp.width, vp.height);

    const minX = Math.floor(tl.x);
    const maxX = Math.ceil(br.x);
    const minY = Math.floor(tl.y);
    const maxY = Math.ceil(br.y);

    const now = performance.now();
    if (
      minX !== this.lastFrameMinX ||
      maxX !== this.lastFrameMaxX ||
      minY !== this.lastFrameMinY ||
      maxY !== this.lastFrameMaxY
    ) {
      this.lastFrameMinX = minX;
      this.lastFrameMaxX = maxX;
      this.lastFrameMinY = minY;
      this.lastFrameMaxY = maxY;
      this.lastMoveTime = now;
      this.rangeChangedSinceDraw = true;
    }

    // The drawn (padded) region no longer covers the screen — a redraw can't
    // wait for settle without a visible gap at the edge.
    const outsideDrawn =
      !this.hasDrawn ||
      minX < this.drawnMinX ||
      maxX > this.drawnMaxX ||
      minY < this.drawnMinY ||
      maxY > this.drawnMaxY;

    // Camera has been still for SETTLE_MS since the range last changed —
    // worldContainer scaling has kept dots visually fine in the meantime, but
    // radius (screen-constant) and coverage are only exactly right once we redraw.
    const settled = now - this.lastMoveTime >= SETTLE_MS;

    if (!this._dirty && !outsideDrawn && !(this.rangeChangedSinceDraw && settled)) {
      return;
    }

    this._dirty = false;
    this.rangeChangedSinceDraw = false;
    // Pad scales with the visible range: a sustained zoom-out grows the range every
    // frame, and a flat pad gets outrun by it — every frame then finds itself
    // outsideDrawn and rebuilds, bypassing the settle throttle entirely.
    const pad = PAD + Math.ceil((maxX - minX) * 0.15);
    this.drawnMinX = minX - pad;
    this.drawnMaxX = maxX + pad;
    this.drawnMinY = minY - pad;
    this.drawnMaxY = maxY + pad;
    this.hasDrawn = true;

    const zoomPx = engine.worldToScreen(1, 0).x - engine.worldToScreen(0, 0).x;
    // Dot radius: ~1.5 screen pixels in world units
    const dotR = Math.max(0.02, 1.5 / Math.max(1, zoomPx));

    this.graphics.clear();
    for (let x = this.drawnMinX; x <= this.drawnMaxX; x++) {
      for (let y = this.drawnMinY; y <= this.drawnMaxY; y++) {
        this.graphics.circle(x, y, dotR);
      }
    }
    // White, tinted by `setDotColor`, so a colour change needs no redraw.
    this.graphics.fill({ color: 0xffffff });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
