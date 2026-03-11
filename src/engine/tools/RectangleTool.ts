import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';

/** RectangleTool stub — full implementation in tools-dev track. */
export class RectangleTool implements DrawingTool {
  readonly type = 'rectangle' as const;
  onPointerDown(_point: Point): void {}
  onPointerMove(_point: Point): void {}
  onPointerUp(_point: Point): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  getPreview(): PreviewShape | null { return null; }
  cancel(): void {}
  isActive(): boolean { return false; }
}
