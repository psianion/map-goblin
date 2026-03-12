import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';

/** PolygonTool stub — full implementation in tools-dev track. */
export class PolygonTool implements DrawingTool {
  readonly type = 'polygon' as const;
  onPointerDown(_point: Point): void {}
  onPointerMove(_point: Point): void {}
  onPointerUp(_point: Point): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  getPreview(): PreviewShape | null { return null; }
  cancel(): void {}
  isActive(): boolean { return false; }
}
