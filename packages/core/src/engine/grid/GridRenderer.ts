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
 * Positioned inside worldContainer so the grid automatically tracks camera pan.
 * Only redraws when zoom level changes enough to alter the visible cell range,
 * or when grid config changes (dirty flag).
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
    const grid = useStore.getState().grid;

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

    const zoomPx = engine.worldToScreen(1, 0).x - engine.worldToScreen(0, 0).x;
    // Dot radius: ~1.5 screen pixels in world units
    const dotR = Math.max(0.02, 1.5 / Math.max(1, zoomPx));

    this.graphics.clear();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        this.graphics.circle(x, y, dotR);
      }
    }
    this.graphics.fill({ color: 0x888888, alpha: 0.45 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
