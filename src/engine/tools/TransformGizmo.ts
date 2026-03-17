import { Container, Graphics } from 'pixi.js';
import type { BoundingBox } from './transformMath';
import {
  snapValueToGrid,
  snapAngle,
  constrainProportions,
  clampScale,
} from './transformMath';
import type { AnyChild } from '@/store/types';
import { getChildBounds, unionChildBounds } from '@/engine/hitTest';

export type HandleType =
  | 'nw' | 'n' | 'ne'
  | 'w' | 'e'
  | 'sw' | 's' | 'se'
  | 'rotate'
  | 'move';

interface HandleZone {
  type: HandleType;
  x: number;
  y: number;
  size: number;
}

const CORNER_SIZE = 10;
const MID_SIZE = 6;
const ROTATION_STEM = 14;
const ROTATION_RADIUS = 5;
const ACCENT_COLOR = 0x6c63ff;
const HANDLE_FILL = 0xffffff;
const MIN_EDGE_PX = 40; // only show mid-edge handles if dimension > this

export class TransformGizmo {
  readonly container = new Container();
  private graphics = new Graphics();
  private handles: HandleZone[] = [];
  private bbox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
  private objectRotation = 0;

  // Drag state
  private dragging = false;
  private dragHandle: HandleType | null = null;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };
  private originalBBox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
  private originalRotation = 0;

  // Callbacks
  onTransformDelta: ((delta: {
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    handle: HandleType;
  }) => void) | null = null;

  onTransformEnd: (() => void) | null = null;
  onTransformCancel: (() => void) | null = null;

  constructor() {
    this.container.label = 'transformGizmo';
    this.container.addChild(this.graphics);
  }

  /**
   * Update the gizmo position/size based on the object's screen-space bounding box.
   * Called every frame from the render loop when an object is selected.
   */
  update(screenBBox: BoundingBox, rotation: number): void {
    this.bbox = screenBBox;
    this.objectRotation = rotation;
    this.draw();
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    this.handles = [];

    const { x, y, width, height } = this.bbox;
    const cx = x + width / 2;
    const cy = y + height / 2;

    // Bounding box outline
    g.setStrokeStyle({ color: ACCENT_COLOR, width: 1.5 });
    g.rect(x, y, width, height);
    g.stroke();

    // Corner handles
    this.drawHandle(g, x, y, CORNER_SIZE, 'nw');
    this.drawHandle(g, x + width, y, CORNER_SIZE, 'ne');
    this.drawHandle(g, x, y + height, CORNER_SIZE, 'sw');
    this.drawHandle(g, x + width, y + height, CORNER_SIZE, 'se');

    // Mid-edge handles (only if dimension is large enough)
    if (width > MIN_EDGE_PX) {
      this.drawHandle(g, cx, y, MID_SIZE, 'n');
      this.drawHandle(g, cx, y + height, MID_SIZE, 's');
    }
    if (height > MIN_EDGE_PX) {
      this.drawHandle(g, x, cy, MID_SIZE, 'w');
      this.drawHandle(g, x + width, cy, MID_SIZE, 'e');
    }

    // Rotation handle stem + circle
    const rotY = y - ROTATION_STEM;
    g.setStrokeStyle({ color: ACCENT_COLOR, width: 1.5 });
    g.moveTo(cx, y);
    g.lineTo(cx, rotY);
    g.stroke();
    g.circle(cx, rotY, ROTATION_RADIUS);
    g.fill(HANDLE_FILL);
    g.setStrokeStyle({ color: ACCENT_COLOR, width: 2 });
    g.stroke();
    this.handles.push({ type: 'rotate', x: cx, y: rotY, size: ROTATION_RADIUS * 2 });
  }

  private drawHandle(g: Graphics, x: number, y: number, size: number, type: HandleType): void {
    const half = size / 2;
    g.rect(x - half, y - half, size, size);
    g.fill(HANDLE_FILL);
    g.setStrokeStyle({
      color: ACCENT_COLOR,
      width: type === 'nw' || type === 'ne' || type === 'sw' || type === 'se' ? 2 : 1.5,
    });
    g.stroke();
    this.handles.push({ type, x, y, size });
  }

  /**
   * Hit-test a screen-space point against handle zones.
   * Returns the handle type or null.
   */
  hitTest(screenX: number, screenY: number): HandleType | null {
    // Check handles in reverse (top-drawn = highest priority)
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const h = this.handles[i];
      const half = Math.max(h.size / 2, 6); // min 6px hit area
      if (
        screenX >= h.x - half &&
        screenX <= h.x + half &&
        screenY >= h.y - half &&
        screenY <= h.y + half
      ) {
        return h.type;
      }
    }

    // Check if inside bounding box (move)
    const { x, y, width, height } = this.bbox;
    if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
      return 'move';
    }

    return null;
  }

  /**
   * Get the CSS cursor string for a handle type.
   */
  getCursor(handle: HandleType | null): string {
    if (!handle) return 'default';
    const cursors: Record<HandleType, string> = {
      nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
      w: 'w-resize', e: 'e-resize',
      sw: 'sw-resize', s: 's-resize', se: 'se-resize',
      rotate: 'grab',
      move: 'move',
    };
    return cursors[handle];
  }

  startDrag(handle: HandleType, screenX: number, screenY: number): void {
    this.dragging = true;
    this.dragHandle = handle;
    this.dragStart = { x: screenX, y: screenY };
    this.originalBBox = { ...this.bbox };
    this.originalRotation = this.objectRotation;
  }

  updateDrag(
    screenX: number,
    screenY: number,
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean },
    snapEnabled: boolean,
    gridSizeScreen: number,
  ): { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: number } | null {
    if (!this.dragging || !this.dragHandle) return null;

    const dx = screenX - this.dragStart.x;
    const dy = screenY - this.dragStart.y;
    const shouldSnap = modifiers.ctrl ? !snapEnabled : snapEnabled;

    let translateX = 0, translateY = 0;
    let scaleX = 1, scaleY = 1;
    let rotation = 0;

    if (this.dragHandle === 'move') {
      translateX = dx;
      translateY = dy;
      if (shouldSnap && gridSizeScreen > 0) {
        translateX = snapValueToGrid(translateX, gridSizeScreen);
        translateY = snapValueToGrid(translateY, gridSizeScreen);
      }
    } else if (this.dragHandle === 'rotate') {
      const cx = this.originalBBox.x + this.originalBBox.width / 2;
      const cy = this.originalBBox.y + this.originalBBox.height / 2;
      const startAngle = Math.atan2(this.dragStart.y - cy, this.dragStart.x - cx);
      const currAngle = Math.atan2(screenY - cy, screenX - cx);
      rotation = currAngle - startAngle;
      if (modifiers.shift || shouldSnap) {
        rotation = snapAngle(rotation);
      }
    } else {
      // Resize handles
      const ob = this.originalBBox;
      let newWidth = ob.width;
      let newHeight = ob.height;

      if (this.dragHandle.includes('e')) newWidth = ob.width + dx;
      if (this.dragHandle.includes('w')) newWidth = ob.width - dx;
      if (this.dragHandle.includes('s')) newHeight = ob.height + dy;
      if (this.dragHandle.includes('n')) newHeight = ob.height - dy;

      // Constrain proportions on corner handles unless Shift held
      const isCorner = ['nw', 'ne', 'sw', 'se'].includes(this.dragHandle);
      if (isCorner && !modifiers.shift) {
        const constrained = constrainProportions(newWidth, newHeight, ob.width, ob.height);
        newWidth = constrained.width;
        newHeight = constrained.height;
      }

      scaleX = clampScale(newWidth / ob.width);
      scaleY = clampScale(newHeight / ob.height);

      if (shouldSnap && gridSizeScreen > 0) {
        newWidth = Math.max(snapValueToGrid(newWidth, gridSizeScreen), gridSizeScreen);
        newHeight = Math.max(snapValueToGrid(newHeight, gridSizeScreen), gridSizeScreen);
        scaleX = clampScale(newWidth / ob.width);
        scaleY = clampScale(newHeight / ob.height);
      }
    }

    return { translateX, translateY, scaleX, scaleY, rotation };
  }

  endDrag(): void {
    this.dragging = false;
    this.dragHandle = null;
    this.onTransformEnd?.();
  }

  cancelDrag(): void {
    this.dragging = false;
    this.dragHandle = null;
    this.onTransformCancel?.();
  }

  isDragging(): boolean {
    return this.dragging;
  }

  getOriginalRotation(): number {
    return this.originalRotation;
  }

  /**
   * Returns the world-space AABB for a single child.
   * Useful for callers that need per-child bounds without importing hitTest directly.
   */
  static getChildBounds(child: AnyChild): BoundingBox {
    return getChildBounds(child);
  }

  /**
   * Returns the union world-space AABB for multiple children.
   * Returns null if the array is empty.
   */
  static unionChildBounds(children: AnyChild[]): BoundingBox | null {
    return unionChildBounds(children);
  }

  destroy(): void {
    this.container.removeFromParent();
    this.graphics.destroy();
    this.container.destroy();
  }
}
