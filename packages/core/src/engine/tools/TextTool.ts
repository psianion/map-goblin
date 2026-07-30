import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { measureLabel } from '../labelMetrics';
import type { DungeonLayer, TextChild } from '../../store/types';

/** World units (grid cells). Roughly a room name at default map scale. */
const DEFAULT_FONT_SIZE = 0.8;
const DEFAULT_TEXT = 'Label';

function countLabels(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'text').length;
}

/**
 * Place a map label. Single click, like the light tool.
 *
 * The label lands with placeholder text and is then edited in the properties
 * panel. Typing directly on the canvas would need an in-world text editor —
 * caret, selection, IME — which is a great deal of machinery for a feature
 * whose text is usually a couple of words.
 */
export class TextTool implements DrawingTool {
  readonly type = 'text' as const;
  readonly cursor = 'crosshair';
  private cursorPoint: Point | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const { width, height } = measureLabel(DEFAULT_TEXT, DEFAULT_FONT_SIZE);
    const child: TextChild = {
      id: crypto.randomUUID(),
      name: `Label ${countLabels(activeLayer) + 1}`,
      childType: 'text',
      visible: true,
      text: DEFAULT_TEXT,
      position: { x: point.x, y: point.y },
      rotation: 0,
      scale: 1,
      fontSize: DEFAULT_FONT_SIZE,
      color: activeLayer.style.wallColor,
      width,
      height,
    };

    undoManager.execute(new AddChildCommand('Place label', activeLayerId, child));
  }

  onPointerMove(point: Point): void {
    this.cursorPoint = point;
  }

  onPointerUp(_point: Point): void {}

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.cursorPoint) return null;
    return { type: 'circle', points: [this.cursorPoint] };
  }

  cancel(): void {
    this.cursorPoint = null;
  }

  isActive(): boolean {
    return false;
  }
}
