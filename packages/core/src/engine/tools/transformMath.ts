export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  translate: [number, number];
  rotate: number;
  scale: [number, number];
}

const MIN_SIZE = 1;
const SNAP_ANGLE_RAD = Math.PI / 12; // 15 degrees

export function computeBoundingBox(points: [number, number][]): BoundingBox {
  if (points.length === 0) return { x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, MIN_SIZE),
    height: Math.max(maxY - minY, MIN_SIZE),
  };
}

export function applyTransformToPoints(
  points: [number, number][],
  t: Transform,
): [number, number][] {
  return points.map(([x, y]) => {
    // Scale
    const sx = x * t.scale[0];
    const sy = y * t.scale[1];
    // Rotate around origin
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    // Translate
    return [rx + t.translate[0], ry + t.translate[1]] as [number, number];
  });
}

export function constrainProportions(
  newWidth: number,
  newHeight: number,
  origWidth: number,
  origHeight: number,
): { width: number; height: number } {
  const aspect = origWidth / origHeight;
  // Use whichever dimension changed more
  if (Math.abs(newWidth - origWidth) > Math.abs(newHeight - origHeight)) {
    return { width: newWidth, height: newWidth / aspect };
  }
  return { width: newHeight * aspect, height: newHeight };
}

export function rotatePoint(
  x: number,
  y: number,
  pivotX: number,
  pivotY: number,
  angle: number,
): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - pivotX;
  const dy = y - pivotY;
  return [
    pivotX + dx * cos - dy * sin,
    pivotY + dx * sin + dy * cos,
  ];
}

export function snapValueToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function snapAngle(angle: number): number {
  return Math.round(angle / SNAP_ANGLE_RAD) * SNAP_ANGLE_RAD;
}

export function clampScale(s: number): number {
  return Math.max(0.01, s);
}

// ─── Box resize (gizmo handles) ─────────────────────────────────────────────

/** A box in world units: centre, own size, and the angle its own axes sit at (radians). */
export interface OrientedBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

const RIGHT_ANGLE_EPS = (0.5 * Math.PI) / 180;

/** True when `angle` is within half a degree of a multiple of 90°. */
export function isRightAngle(angle: number): boolean {
  const q = angle / (Math.PI / 2);
  return Math.abs(q - Math.round(q)) * (Math.PI / 2) < RIGHT_ANGLE_EPS;
}

/**
 * How a child's own width and height scale when a box around it scales by (sx, sy) on
 * the world axes, the child sitting at `theta`. Exact at multiples of 90° (a child turned
 * a quarter takes the box's height scale on its width), the closest skew-free fit between.
 */
export function localScaleFor(theta: number, sx: number, sy: number): { su: number; sv: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { su: Math.hypot(sx * c, sy * s), sv: Math.hypot(sx * s, sy * c) };
}

/**
 * The box after dragging `handle` by `d` (world units), measured on the box's own axes so
 * a turned box grows along its length, not along the screen.
 *
 * Corners keep the ratio and Shift frees them; edges move one side and Shift keeps the
 * ratio. Alt grows about the centre, read on every move. With a snap step, a box at a
 * multiple of 90° lands its moving edge on the grid, any other angle snaps its size; a
 * kept ratio snaps the axis that leads and derives the other, so the ratio survives.
 */
export function resizeBox(
  box: OrientedBox,
  handle: ResizeHandle,
  d: { x: number; y: number },
  mods: { shift: boolean; alt: boolean },
  snapStep: number | null,
  minSize = 0.01,
): OrientedBox {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const du = d.x * cos + d.y * sin;
  const dv = -d.x * sin + d.y * cos;
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const reach = mods.alt ? 2 : 1;
  const corner = hx !== 0 && hy !== 0;
  const keep = corner ? !mods.shift : mods.shift;

  let w = hx ? box.w + hx * du * reach : box.w;
  let h = hy ? box.h + hy * dv * reach : box.h;
  // The axis that leads a kept ratio: the dragged one on an edge, the one that changed
  // more (relative to its size) on a corner.
  const leadU = hx !== 0 && (!corner || Math.abs(w / box.w - 1) >= Math.abs(h / box.h - 1));

  const right = isRightAngle(box.angle);
  const snapSize = (size: number, axis: 'u' | 'v'): number => {
    if (!snapStep) return size;
    if (!right) return Math.max(snapStep, Math.round(size / snapStep) * snapStep);
    const dir = axis === 'u' ? hx : hy;
    const old = axis === 'u' ? box.w : box.h;
    // The moving edge, along the box's own axis, measured from the old centre.
    const anchor = mods.alt ? 0 : -dir * (old / 2);
    const edge = mods.alt ? (dir * size) / 2 : anchor + dir * size;
    const [ax, ay] = axis === 'u' ? [cos, sin] : [-sin, cos];
    const along = Math.abs(ax) > 0.5 ? ax : ay;
    const origin = Math.abs(ax) > 0.5 ? box.cx : box.cy;
    const snapped = (Math.round((origin + along * edge) / snapStep) * snapStep - origin) / along;
    const next = mods.alt ? 2 * dir * snapped : dir * (snapped - anchor);
    return Math.max(snapStep, next);
  };

  if (keep) {
    const ratio = box.w / box.h;
    if (leadU) {
      w = Math.max(snapSize(w, 'u'), minSize);
      h = w / ratio;
    } else {
      h = Math.max(snapSize(h, 'v'), minSize);
      w = h * ratio;
    }
  } else {
    if (hx) w = snapSize(w, 'u');
    if (hy) h = snapSize(h, 'v');
  }
  w = Math.max(w, minSize);
  h = Math.max(h, minSize);

  // The side opposite the handle stays put (the centre does, with Alt).
  const ou = mods.alt || !hx ? 0 : (hx * (w - box.w)) / 2;
  const ov = mods.alt || !hy ? 0 : (hy * (h - box.h)) / 2;
  return {
    cx: box.cx + ou * cos - ov * sin,
    cy: box.cy + ou * sin + ov * cos,
    w,
    h,
    angle: box.angle,
  };
}
