import type { Point } from '@/types/geometry';

export type ToolType =
  | 'select'
  | 'object'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'door'
  | 'light'
  | 'ruler'
  | 'assetPlacement'
  | 'scatterBrush';

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
  /** Returns a CSS cursor string when hovering over a transform handle, or null. */
  getHoverCursor?(sx: number, sy: number): string | null;
  /** Called every frame to sync screen-space gizmo position. */
  updateGizmo?(): void;
}
