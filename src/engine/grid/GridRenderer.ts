import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';

/**
 * Renders the background grid.
 * Stub — full grid rendering implementation deferred.
 */
export class GridRenderer {
  readonly container: Container;
  private graphics: Graphics;
  private _dirty = true;

  constructor() {
    this.container = new Container();
    this.container.label = 'gridRenderer';
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  markDirty(): void {
    this._dirty = true;
  }

  update(_engine: RenderEngine): void {
    if (!this._dirty) return;
    this._dirty = false;
    // No-op stub — full grid rendering not yet implemented
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
