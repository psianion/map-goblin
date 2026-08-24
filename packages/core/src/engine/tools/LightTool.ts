import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { AddChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import type { LightChild, DungeonLayer, AssetChild } from '../../store/types';

function countLightsInLayer(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'light').length;
}

/** Within 0.5 cells of an asset's centre attaches the light to it — nearest wins. */
const ATTACH_RADIUS = 0.5;

function findAttachTarget(layer: DungeonLayer, point: Point): AssetChild | undefined {
  let best: AssetChild | undefined;
  let bestDist = ATTACH_RADIUS;
  for (const c of layer.children) {
    if (c.childType !== 'asset') continue;
    const dx = c.position.x - point.x;
    const dy = c.position.y - point.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export class LightTool implements DrawingTool {
  readonly type = 'light' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private cursorPoint: Point | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const defaults = store.tools.settings.lightDefaults;
    const attachTarget = findAttachTarget(activeLayer, point);

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
      ...(attachTarget ? { attachedTo: attachTarget.id } : {}),
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
