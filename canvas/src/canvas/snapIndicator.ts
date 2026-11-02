import { Container, Graphics } from 'pixi.js';
import type { Point } from '@/types/geometry';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';

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
    // The cross-hair is drawn in the desk's ink, hairline.
    const ink = parseInt((getEditorDesk()?.ink ?? '#1b1b1b').replace('#', ''), 16);
    // A 1px line lands crisp on the half pixel.
    const x = Math.round(screenPoint.x) + 0.5;
    const y = Math.round(screenPoint.y) + 0.5;
    this.graphics
      .setStrokeStyle({ color: ink, width: 1 })
      .moveTo(x - r, y)
      .lineTo(x + r, y)
      .moveTo(x, y - r)
      .lineTo(x, y + r)
      .stroke();
  }

  hide(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
