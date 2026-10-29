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
    // On an editor desk the cross-hair is drawn in the desk's ink, hairline.
    const desk = getEditorDesk();
    const ink = desk ? parseInt(desk.ink.replace('#', ''), 16) : null;
    // A 1px line lands crisp on the half pixel.
    const x = ink === null ? screenPoint.x : Math.round(screenPoint.x) + 0.5;
    const y = ink === null ? screenPoint.y : Math.round(screenPoint.y) + 0.5;
    this.graphics
      .setStrokeStyle(ink === null ? { color: 0x44aaff, width: 1.5 } : { color: ink, width: 1 })
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
