import { Container, Graphics, Text } from 'pixi.js';
import type { Point } from '@/types/geometry';
import type { PreviewShape } from '@dnd/core/src/engine/tools/DrawingTool';
import { useStore } from '@/store/store';

/** Preview types the HUD knows how to measure. */
const MEASURED_TOOLS = new Set(['rectangle', 'wall', 'path', 'polygon']);

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Live dimension readout next to the cursor while drawing — grid squares
 * first, map units (usually feet) second. Rectangles read "3 × 2", chained
 * lines read their running length.
 */
export class DimensionHud {
  private root: Container;
  private bg: Graphics;
  private text: Text;

  constructor(overlayContainer: Container) {
    this.root = new Container();
    this.root.label = 'dimensionHud';
    this.root.visible = false;
    this.bg = new Graphics();
    this.text = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff },
    });
    this.text.position.set(6, 3);
    this.root.addChild(this.bg, this.text);
    overlayContainer.addChild(this.root);
  }

  update(toolType: string, preview: PreviewShape, cursorScreen: Point, canvasWidth = 0): void {
    const label = this.label(toolType, preview);
    if (!label) {
      this.hide();
      return;
    }
    if (this.text.text !== label) {
      this.text.text = label;
      this.bg
        .clear()
        .roundRect(0, 0, this.text.width + 12, this.text.height + 6, 4)
        .fill({ color: 0x1a1a1a, alpha: 0.85 });
    }
    // Sits below-right of the cursor, clear of the arrow and the snap
    // crosshair — but flips to its left near the right edge, where it would
    // otherwise run off the canvas and under the side panel.
    const w = this.text.width + 12;
    const x = cursorScreen.x + 18;
    this.root.position.set(
      canvasWidth && x + w > canvasWidth ? cursorScreen.x - 18 - w : x,
      cursorScreen.y + 20,
    );
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private label(toolType: string, preview: PreviewShape): string | null {
    if (!MEASURED_TOOLS.has(toolType) || preview.points.length < 2) return null;
    const { value, unit } = useStore.getState().mapSettings.cellScale;

    if (toolType === 'rectangle') {
      const pts = preview.points;
      const w = Math.abs(pts[2].x - pts[0].x);
      const h = Math.abs(pts[2].y - pts[0].y);
      return `${fmt(w)} × ${fmt(h)}  ·  ${fmt(w * value)} × ${fmt(h * value)} ${unit}`;
    }

    // Chained tools: running length of the whole preview polyline. In curve
    // mode the preview is the smoothed curve, so this measures the real path.
    let len = 0;
    const pts = preview.points;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return `${fmt(len)}  ·  ${fmt(len * value)} ${unit}`;
  }
}
