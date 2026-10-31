import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BoundingBox } from './transformMath';
import {
  snapValueToGrid,
  snapAngle,
  constrainProportions,
  clampScale,
} from './transformMath';
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

/**
 * A box under this on screen in either axis has its handles pushed out, `HANDLE_OUTSET`
 * clear of its sides, so a press inside it moves rather than resizes (a 0.8 sq label pin
 * is mostly handle otherwise).
 */
export const SMALL_BOX_PX = 28;
export const HANDLE_OUTSET = 10;

type ResizeDir = Exclude<HandleType, 'rotate' | 'move'>;

/** What the gizmo offers for the current selection. */
export interface GizmoConfig {
  /** Rotation stem — off for children with no rotation (lights). */
  showRotate: boolean;
  /** Measurement chip content; null hides the chip. */
  chip: string | null;
  /**
   * The box's own angle, radians. A single prop or label is boxed on its own axes, so
   * its handles sit on its sides and drag along them; a union box stays at 0.
   */
  rotation: number;
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
  /** Box and handles, turned about the box centre by `config.rotation`. */
  private frame = new Container();
  private graphics = new Graphics();
  private chipText: Text;
  private chipBg = new Graphics();
  private handles: HandleZone[] = [];
  private bbox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
  private config: GizmoConfig = { showRotate: true, chip: null, rotation: 0 };

  // Drag state
  private dragging = false;
  private dragHandle: HandleType | null = null;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };
  private originalBBox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    this.container.label = 'transformGizmo';
    this.frame.addChild(this.graphics);
    this.container.addChild(this.frame);
    this.chipText = new Text({ text: '', style: chipStyle(), resolution: 2 });
    this.container.addChild(this.chipBg);
    this.container.addChild(this.chipText);
  }

  /**
   * Update the gizmo position/size based on the object's screen-space bounding box.
   * Called every frame from the render loop when an object is selected. With a
   * `rotation`, the box is the unturned one around the centre it turns about.
   */
  update(screenBBox: BoundingBox, config?: Partial<GizmoConfig>): void {
    this.bbox = screenBBox;
    if (config) this.config = { ...this.config, ...config };
    this.draw();
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    this.handles = [];

    const { x, y, width, height } = this.bbox;
    const cx = x + width / 2;
    // Drawn unturned, then the frame turns about the centre.
    this.frame.pivot.set(cx, y + height / 2);
    this.frame.position.set(cx, y + height / 2);
    this.frame.rotation = this.config.rotation;

    // Bounding box: white line carried by an ink underlay so it reads on any art.
    g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_INK, alpha: OVERLAY_INK_ALPHA });
    g.rect(x, y, width, height);
    g.stroke();
    g.setStrokeStyle({ color: OVERLAY_WHITE, width: LINE_WHITE });
    g.rect(x, y, width, height);
    g.stroke();

    // A small box keeps its inside for moving: the handles stand off its sides.
    const o = width < SMALL_BOX_PX || height < SMALL_BOX_PX ? HANDLE_OUTSET : 0;

    // Corner handles
    this.drawSquare(g, x - o, y - o, 'nw');
    this.drawSquare(g, x + width + o, y - o, 'ne');
    this.drawSquare(g, x - o, y + height + o, 'sw');
    this.drawSquare(g, x + width + o, y + height + o, 'se');

    // Mid-edge pills (only if the edge is long enough to leave room)
    const cy = y + height / 2;
    if (width > MIN_EDGE_PX) {
      this.drawPill(g, cx, y - o, true, 'n');
      this.drawPill(g, cx, y + height + o, true, 's');
    }
    if (height > MIN_EDGE_PX) {
      this.drawPill(g, x - o, cy, false, 'w');
      this.drawPill(g, x + width + o, cy, false, 'e');
    }

    // Rotation handle stem + circle
    if (this.config.showRotate) {
      const top = y - o;
      const rotY = top - ROTATE_STEM - ROTATE_DIAMETER / 2;
      g.setStrokeStyle({ color: OVERLAY_INK, width: LINE_INK, alpha: OVERLAY_INK_ALPHA });
      g.moveTo(cx, top);
      g.lineTo(cx, top - ROTATE_STEM);
      g.stroke();
      g.setStrokeStyle({ color: OVERLAY_WHITE, width: LINE_WHITE });
      g.moveTo(cx, top);
      g.lineTo(cx, top - ROTATE_STEM);
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
    // Under the turned box: the lowest of its corners.
    const c = Math.abs(Math.cos(this.config.rotation));
    const s = Math.abs(Math.sin(this.config.rotation));
    const halfH = (width * s + height * c) / 2;
    const pad = 5;
    const tw = this.chipText.width;
    const th = this.chipText.height;
    const chipX = x + width / 2 - tw / 2;
    const chipY = y + height / 2 + halfH + 10;
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
    [screenX, screenY] = this.toLocal(screenX, screenY);
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

  /** A screen point in the unturned frame the handles were laid out in. */
  private toLocal(sx: number, sy: number): [number, number] {
    const angle = this.config.rotation;
    if (angle === 0) return [sx, sy];
    const cx = this.bbox.x + this.bbox.width / 2;
    const cy = this.bbox.y + this.bbox.height / 2;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = sx - cx;
    const dy = sy - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  /**
   * Get the CSS cursor string for a handle type: the resize arrow that points the way
   * the handle moves on screen, so a turned box's handles show turned arrows.
   */
  getCursor(handle: HandleType | null): string {
    if (!handle) return 'default';
    if (handle === 'rotate') return 'grab';
    if (handle === 'move') return 'move';
    const dirs: ResizeDir[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
    const octant = Math.round(this.config.rotation / (Math.PI / 4));
    const turned = dirs[(((dirs.indexOf(handle) + octant) % 8) + 8) % 8];
    return `${turned}-resize`;
  }

  startDrag(handle: HandleType, screenX: number, screenY: number): void {
    this.dragging = true;
    this.dragHandle = handle;
    this.dragStart = { x: screenX, y: screenY };
    this.originalBBox = { ...this.bbox };
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
  }

  cancelDrag(): void {
    this.dragging = false;
    this.dragHandle = null;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  destroy(): void {
    this.container.removeFromParent();
    this.graphics.destroy();
    this.frame.destroy();
    this.chipText.destroy();
    this.chipBg.destroy();
    this.container.destroy();
  }
}
