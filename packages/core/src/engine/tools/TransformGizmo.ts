import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BoundingBox } from './transformMath';
import {
  snapValueToGrid,
  snapAngle,
  constrainProportions,
  clampScale,
} from './transformMath';
import type { AnyChild } from '../../store/types';
import { getChildBounds, unionChildBounds } from '../hitTest';
import {
  OVERLAY_WHITE,
  OVERLAY_INK,
  OVERLAY_INK_ALPHA,
  HANDLE_BORDER_ALPHA,
  HANDLE_SIZE,
  PILL_LENGTH,
  PILL_THICKNESS,
  ROTATE_DIAMETER,
  ROTATE_STEM,
  HANDLE_HIT_HALF,
  LINE_WHITE,
  LINE_INK,
} from '../overlayPalette';

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
  /** Half-width and half-height of the hit zone, not the drawn size. */
  hitHalfX: number;
  hitHalfY: number;
}

const MIN_EDGE_PX = 40; // only show mid-edge handles if dimension > this

/** What the gizmo offers for the current selection. */
export interface GizmoConfig {
  /** Rotation stem — off for children with no rotation (lights). */
  showRotate: boolean;
  /** Measurement chip content; null hides the chip. */
  chip: string | null;
}

// Built lazily: TextStyle touches canvas text metrics at construction, which
// the node test environment doesn't have — module import must stay side-effect
// free for anything that imports SelectTool.
function chipStyle(): TextStyle {
  return new TextStyle({
    fontFamily: 'IBM Plex Mono, Consolas, monospace',
    fontSize: 11,
    fill: OVERLAY_WHITE,
  });
}

export class TransformGizmo {
  readonly container = new Container();
  private graphics = new Graphics();
  private chipText: Text;
  private chipBg = new Graphics();
  private handles: HandleZone[] = [];
  private bbox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
  private objectRotation = 0;
  private config: GizmoConfig = { showRotate: true, chip: null };

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
    this.chipText = new Text({ text: '', style: chipStyle(), resolution: 2 });
    this.container.addChild(this.chipBg);
    this.container.addChild(this.chipText);
  }

  /**
   * Update the gizmo position/size based on the object's screen-space bounding box.
   * Called every frame from the render loop when an object is selected.
   */
  update(screenBBox: BoundingBox, rotation: number, config?: Partial<GizmoConfig>): void {
    this.bbox = screenBBox;
    this.objectRotation = rotation;
    if (config) this.config = { ...this.config, ...config };
    this.draw();
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    this.handles = [];

    const { x, y, width, height } = this.bbox;
    const cx = x + width / 2;

    // Bounding box: white line carried by an ink underlay so it reads on any art.
    g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_INK, alpha: OVERLAY_INK_ALPHA });
    g.rect(x, y, width, height);
    g.stroke();
    g.setStrokeStyle({ color: OVERLAY_WHITE, width: LINE_WHITE });
    g.rect(x, y, width, height);
    g.stroke();

    // Corner handles
    this.drawSquare(g, x, y, 'nw');
    this.drawSquare(g, x + width, y, 'ne');
    this.drawSquare(g, x, y + height, 'sw');
    this.drawSquare(g, x + width, y + height, 'se');

    // Mid-edge pills (only if the edge is long enough to leave room)
    const cy = y + height / 2;
    if (width > MIN_EDGE_PX) {
      this.drawPill(g, cx, y, true, 'n');
      this.drawPill(g, cx, y + height, true, 's');
    }
    if (height > MIN_EDGE_PX) {
      this.drawPill(g, x, cy, false, 'w');
      this.drawPill(g, x + width, cy, false, 'e');
    }

    // Rotation handle stem + circle
    if (this.config.showRotate) {
      const rotY = y - ROTATE_STEM - ROTATE_DIAMETER / 2;
      g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_INK, alpha: OVERLAY_INK_ALPHA });
      g.moveTo(cx, y);
      g.lineTo(cx, y - ROTATE_STEM);
      g.stroke();
      g.setStrokeStyle({ color: OVERLAY_WHITE, width: LINE_WHITE });
      g.moveTo(cx, y);
      g.lineTo(cx, y - ROTATE_STEM);
      g.stroke();
      g.circle(cx, rotY, ROTATE_DIAMETER / 2);
      g.fill(OVERLAY_WHITE);
      g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_WHITE, alpha: HANDLE_BORDER_ALPHA });
      g.stroke();
      this.handles.push({
        type: 'rotate',
        x: cx,
        y: rotY,
        hitHalfX: HANDLE_HIT_HALF,
        hitHalfY: HANDLE_HIT_HALF,
      });
    }

    this.drawChip();
  }

  private drawSquare(g: Graphics, x: number, y: number, type: HandleType): void {
    const half = HANDLE_SIZE / 2;
    g.rect(x - half, y - half, HANDLE_SIZE, HANDLE_SIZE);
    g.fill(OVERLAY_WHITE);
    g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_WHITE, alpha: HANDLE_BORDER_ALPHA });
    g.stroke();
    this.handles.push({ type, x, y, hitHalfX: HANDLE_HIT_HALF, hitHalfY: HANDLE_HIT_HALF });
  }

  private drawPill(g: Graphics, x: number, y: number, horizontal: boolean, type: HandleType): void {
    const w = horizontal ? PILL_LENGTH : PILL_THICKNESS;
    const h = horizontal ? PILL_THICKNESS : PILL_LENGTH;
    g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
    g.fill(OVERLAY_WHITE);
    g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_WHITE, alpha: HANDLE_BORDER_ALPHA });
    g.stroke();
    this.handles.push({
      type,
      x,
      y,
      hitHalfX: Math.max(w / 2, HANDLE_HIT_HALF),
      hitHalfY: Math.max(h / 2, HANDLE_HIT_HALF),
    });
  }

  /** Measurement chip centred under the box: "4.0 × 2.5 sq · 15°". */
  private drawChip(): void {
    const text = this.config.chip;
    this.chipText.visible = this.chipBg.visible = text !== null;
    this.chipBg.clear();
    if (text === null) return;

    if (this.chipText.text !== text) this.chipText.text = text;
    const { x, y, width, height } = this.bbox;
    const pad = 5;
    const tw = this.chipText.width;
    const th = this.chipText.height;
    const chipX = x + width / 2 - tw / 2;
    const chipY = y + height + 10;
    this.chipText.position.set(chipX, chipY);
    this.chipBg.roundRect(chipX - pad, chipY - 2, tw + pad * 2, th + 4, 4);
    this.chipBg.fill({ color: OVERLAY_INK, alpha: 0.78 });
  }

  /**
   * Hit-test a screen-space point against handle zones.
   *
   * Deliberately handles-only: a point inside the box that misses every handle
   * returns null, so SelectTool re-hit-tests the actual children under the
   * cursor. The old whole-box 'move' fallback made every near-miss silently
   * drag the object, and a big selected child (a radius-6 light) an
   * unclickable-through trap covering half the room. `bboxIsMove` restores the
   * old behavior for the legacy region-cut overlay, whose selection has no
   * children to re-hit-test.
   */
  hitTest(screenX: number, screenY: number, opts?: { bboxIsMove?: boolean }): HandleType | null {
    // Check handles in reverse (top-drawn = highest priority)
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const h = this.handles[i];
      if (
        screenX >= h.x - h.hitHalfX &&
        screenX <= h.x + h.hitHalfX &&
        screenY >= h.y - h.hitHalfY &&
        screenY <= h.y + h.hitHalfY
      ) {
        return h.type;
      }
    }

    if (opts?.bboxIsMove) {
      const { x, y, width, height } = this.bbox;
      if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
        return 'move';
      }
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

      // Alt grows the box about its centre, so the edge opposite the one being
      // dragged moves out by the same amount — hence twice the delta.
      const reach = modifiers.alt ? 2 : 1;
      if (this.dragHandle.includes('e')) newWidth = ob.width + dx * reach;
      if (this.dragHandle.includes('w')) newWidth = ob.width - dx * reach;
      if (this.dragHandle.includes('s')) newHeight = ob.height + dy * reach;
      if (this.dragHandle.includes('n')) newHeight = ob.height - dy * reach;

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
    this.chipText.destroy();
    this.chipBg.destroy();
    this.container.destroy();
  }
}
