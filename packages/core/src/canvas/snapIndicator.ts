import { Container, Graphics } from 'pixi.js';
import type { Point } from '../types/geometry';

/**
 * Renders a snap indicator cross-hair in the overlay container.
 */
export class SnapIndicator {
  private graphics: Graphics;

  constructor(overlayContainer: Container) {
    this.graphics = new Graphics();
    this.graphics.label = 'snapIndicator';
    overlayContainer.addChild(this.graphics);
  }

  show(screenPoint: Point): void {
    this.graphics.clear();
    const r = 6;
    this.graphics
      .setStrokeStyle({ color: 0x44aaff, width: 1.5 })
      .moveTo(screenPoint.x - r, screenPoint.y)
      .lineTo(screenPoint.x + r, screenPoint.y)
      .moveTo(screenPoint.x, screenPoint.y - r)
      .lineTo(screenPoint.x, screenPoint.y + r)
      .stroke();
  }

  hide(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
