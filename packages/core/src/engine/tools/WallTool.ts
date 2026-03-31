import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '../../store/store';
import { AddWallCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer } from '../../store/types';

export class WallTool implements DrawingTool {
  readonly type = 'wall' as const;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private drawing = false;

  onPointerDown(point: Point): void {
    this.startPoint = point;
    this.currentPoint = point;
    this.drawing = true;
  }

  onPointerMove(point: Point): void {
    if (!this.drawing) return;
    this.currentPoint = point;
  }

  onPointerUp(point: Point): void {
    if (!this.drawing || !this.startPoint) return;
    this.drawing = false;

    const start = this.startPoint;
    const end = point;
    this.startPoint = null;
    this.currentPoint = null;

    // Ignore zero-length walls
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.sqrt(dx * dx + dy * dy) < 0.01) return;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const wall = {
      id: crypto.randomUUID(),
      points: [[start.x, start.y], [end.x, end.y]] as [number, number][],
      wallType: store.tools.settings.wallType,
      direction: store.tools.settings.wallDirection,
      color: activeLayer.style.wallColor,
      width: activeLayer.style.wallWidth,
      roughness: store.tools.roughMode ? activeLayer.style.roughnessAmplitude : 0,
    };

    undoManager.execute(new AddWallCommand('Draw wall', activeLayerId, wall));
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.drawing || !this.startPoint || !this.currentPoint) return null;
    return {
      type: 'line',
      points: [this.startPoint, this.currentPoint],
    };
  }

  cancel(): void {
    this.startPoint = null;
    this.currentPoint = null;
    this.drawing = false;
  }

  isActive(): boolean {
    return this.drawing;
  }
}
