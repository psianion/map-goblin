import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { createLight } from '@/store/factories';
import { PlaceLightCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';

export class LightTool implements DrawingTool {
  readonly type = 'light' as const;
  private cursorPoint: Point | null = null;

  onPointerDown(point: Point): void {
    const light = createLight({ x: point.x, y: point.y });
    undoManager.execute(new PlaceLightCommand(light));
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
