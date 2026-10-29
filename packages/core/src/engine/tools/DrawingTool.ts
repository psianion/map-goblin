import type { Point } from '../../types/geometry';

export type ToolType =
  | 'select'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'door'
  | 'light'
  | 'ruler'
  | 'scatterBrush'
  | 'terrain'
  | 'water'
  | 'text'
  | 'zone'
  | 'roomRect'
  | 'roomPolygon'
  | 'divide';

export interface PreviewShape {
  type: 'polygon' | 'rectangle' | 'circle' | 'line';
  points: Point[];
}

/** Two clicks this far apart in time are separate clicks, never a double-click. */
const DOUBLE_CLICK_MS = 300;
/**
 * ...and this far apart in world units. Time alone is not enough: a fast user
 * clicking along a chain lands successive anchors well inside 300ms, and
 * without a distance check every one of those pairs commits the chain early.
 */
const DOUBLE_CLICK_SLOP = 0.35;

/**
 * True when `point` at `now` completes a double-click on `last`.
 * Shared by every click-to-chain tool so they agree on what a double-click is.
 */
export function isDoubleClick(
  last: { point: Point; time: number } | null,
  point: Point,
  now: number,
): boolean {
  if (!last) return false;
  return (
    now - last.time < DOUBLE_CLICK_MS &&
    Math.hypot(point.x - last.point.x, point.y - last.point.y) <= DOUBLE_CLICK_SLOP
  );
}

export interface DrawingTool {
  readonly type: ToolType;
  /** CSS cursor for this tool when idle (default: 'default'). Gizmo hover overrides via getHoverCursor. */
  readonly cursor?: string;
  /** True when the tool draws into the active dungeon layer — gates pointerDown on layer selection/lock/visibility (ToolManager). */
  readonly editsActiveLayer?: boolean;
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
  /** A wheel turn over the canvas, before it zooms. True takes it (no zoom). Ctrl+wheel never reaches here. */
  onWheel?(e: WheelEvent, world: Point): boolean;
  /** A right-click on the canvas, before the context menu. True takes it (no menu). */
  onContextMenu?(world: Point, e: MouseEvent): boolean;
  /** A key this tool answers itself, ahead of the global shortcut bound to it (the Light tool's R). */
  ownsKey?(e: KeyboardEvent): boolean;
}
