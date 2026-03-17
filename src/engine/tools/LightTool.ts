import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { AddChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { useStore } from '@/store/store';
import type { LightChild, DungeonLayer } from '@/store/types';

function countLightsInLayer(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'light').length;
}

export class LightTool implements DrawingTool {
  readonly type = 'light' as const;
  private cursorPoint: Point | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const defaults = store.tools.settings.lightDefaults;

    const child: LightChild = {
      id: crypto.randomUUID(),
      name: `Light ${countLightsInLayer(activeLayer) + 1}`,
      childType: 'light',
      visible: true,
      color: defaults.color,
      radius: defaults.radius,
      featherRadius: defaults.featherRadius,
      intensity: defaults.intensity,
      falloff: defaults.falloff,
      position: { x: point.x, y: point.y },
    };

    undoManager.execute(new AddChildCommand('Place light', activeLayerId, child));
  }

  onPointerMove(point: Point): void {
    this.cursorPoint = point;
  }

  onPointerUp(_point: Point): void {
    // no-op — single-click tool
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    }
  }

  getPreview(): PreviewShape | null {
    if (!this.cursorPoint) return null;
    return {
      type: 'circle',
      points: [this.cursorPoint],
    };
  }

  cancel(): void {
    this.cursorPoint = null;
  }

  isActive(): boolean {
    return false;
  }
}
