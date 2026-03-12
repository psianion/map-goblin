import type { Point } from '@/types/geometry';

export type ToolType =
  | 'select'
  | 'object'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'light'
  | 'ruler'
  | 'assetPlacement';

export interface PreviewShape {
  type: 'polygon' | 'rectangle' | 'circle' | 'line';
  points: Point[];
}

export interface DrawingTool {
  readonly type: ToolType;
  onPointerDown(point: Point, event?: PointerEvent): void;
  onPointerMove(point: Point, event?: PointerEvent): void;
  onPointerUp(point: Point, event?: PointerEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  getPreview(): PreviewShape | null;
  cancel(): void;
  isActive(): boolean;
}
