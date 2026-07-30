import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { rulerMeasurement } from '../rulerMeasurement';

/**
 * Measure a distance. Drag to measure; the reading stays up after release so it
 * can be read and compared, and clears on Escape or the next drag.
 *
 * Nothing is committed to the map — `ruler` was declared in the ToolType union
 * and in DrawingTool for a long time without an implementation behind it, which
 * is why it never appeared in the toolbar.
 */
export class RulerTool implements DrawingTool {
  readonly type = 'ruler' as const;
  readonly cursor = 'crosshair';
  private start: Point | null = null;
  private current: Point | null = null;
  private dragging = false;

  private publish(): void {
    rulerMeasurement.current =
      this.start && this.current
        ? { cells: Math.hypot(this.current.x - this.start.x, this.current.y - this.start.y) }
        : null;
  }

  onPointerDown(point: Point): void {
    this.start = point;
    this.current = point;
    this.dragging = true;
    this.publish();
  }

  onPointerMove(point: Point): void {
    if (!this.dragging) return;
    this.current = point;
    this.publish();
  }

  onPointerUp(point: Point): void {
    if (!this.dragging) return;
    this.current = point;
    this.dragging = false;
    this.publish();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.start || !this.current) return null;
    return { type: 'line', points: [this.start, this.current] };
  }

  cancel(): void {
    this.start = null;
    this.current = null;
    this.dragging = false;
    this.publish();
  }

  isActive(): boolean {
    return this.dragging;
  }
}
