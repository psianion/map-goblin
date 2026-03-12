import { Container } from 'pixi.js';
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';

/** Overlay helper used by ObjectTool. */
class ToolOverlay {
  readonly container = new Container();
  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {}
}

/** ObjectTool stub — full implementation in tools-dev track. */
export class ObjectTool implements DrawingTool {
  readonly type = 'object' as const;
  readonly overlay = new ToolOverlay();
  onPointerDown(_point: Point): void {}
  onPointerMove(_point: Point): void {}
  onPointerUp(_point: Point): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  getPreview(): PreviewShape | null { return null; }
  cancel(): void {}
  isActive(): boolean { return false; }
}
