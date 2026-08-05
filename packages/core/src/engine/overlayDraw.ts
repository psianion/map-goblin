// Shared drawing for node-editing overlays — the same white+ink "target"
// furniture the transform gizmo uses (see overlayPalette.ts), for Graphics
// that live in WORLD space: every size takes the current zoom and converts.

import type { Graphics } from 'pixi.js';
import {
  OVERLAY_WHITE,
  OVERLAY_INK,
  OVERLAY_INK_ALPHA,
  HANDLE_BORDER_ALPHA,
} from './overlayPalette';

/** Node handle: 11px visual square/circle, matching the gizmo's corners. */
const NODE_HANDLE_PX = 11;
/** Rope-dash rhythm in screen px — the mockup's 7-on/5-off. */
const DASH_PX = 7;
const GAP_PX = 5;

/**
 * Dashed polyline, white carried by a wider ink underlay, dash rhythm fixed in
 * screen px. This is the "being edited" outline: dashes read as provisional
 * where a solid line reads as geometry.
 */
export function strokeRopeDash(
  g: Graphics,
  pts: [number, number][],
  closed: boolean,
  zoom: number,
): void {
  const z = zoom > 0 ? zoom : 1;
  const dash = DASH_PX / z;
  const gap = GAP_PX / z;
  const inkWidth = 4 / z;
  const whiteWidth = 1.5 / z;

  const segs: [number, number][][] = [];
  const n = closed ? pts.length : pts.length - 1;
  let carry = 0;
  let penDown = true;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let d = 0;
    while (d < len) {
      const runLen = (penDown ? dash : gap) - carry;
      const step = Math.min(runLen, len - d);
      if (penDown) {
        segs.push([
          [a[0] + ux * d, a[1] + uy * d],
          [a[0] + ux * (d + step), a[1] + uy * (d + step)],
        ]);
      }
      d += step;
      if (step === runLen) {
        penDown = !penDown;
        carry = 0;
      } else {
        carry += step;
      }
    }
  }

  for (const width of [inkWidth, whiteWidth]) {
    for (const [a, b] of segs) {
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.stroke({
      color: width === inkWidth ? OVERLAY_INK : OVERLAY_WHITE,
      width,
      alpha: width === inkWidth ? OVERLAY_INK_ALPHA : 1,
    });
  }
}

/**
 * One node handle. Squares are corner/vertex anchors; circles are smooth
 * anchors (and wall stones, which have no corner semantics). Selected handles
 * get the double ring — ink ring inside a white halo — same as the mockups.
 */
export function drawNodeHandle(
  g: Graphics,
  x: number,
  y: number,
  zoom: number,
  opts: { selected?: boolean; hollow?: boolean; circle?: boolean } = {},
): void {
  const z = zoom > 0 ? zoom : 1;
  const half = NODE_HANDLE_PX / 2 / z;
  const border = 1.5 / z;

  if (opts.selected) {
    // White halo first, then ink ring, then the handle itself.
    if (opts.circle) g.circle(x, y, half + 3.5 / z);
    else g.rect(x - half - 3.5 / z, y - half - 3.5 / z, (half + 3.5 / z) * 2, (half + 3.5 / z) * 2);
    g.fill({ color: OVERLAY_WHITE, alpha: 1 });
    if (opts.circle) g.circle(x, y, half + 2 / z);
    else g.rect(x - half - 2 / z, y - half - 2 / z, (half + 2 / z) * 2, (half + 2 / z) * 2);
    g.fill({ color: OVERLAY_INK, alpha: 0.9 });
  }

  if (opts.circle) g.circle(x, y, half);
  else g.rect(x - half, y - half, half * 2, half * 2);
  if (opts.hollow) {
    g.fill({ color: OVERLAY_INK, alpha: 0.35 });
    g.stroke({ color: OVERLAY_WHITE, width: border, alpha: 1 });
  } else {
    g.fill({ color: OVERLAY_WHITE, alpha: 1 });
    g.stroke({ color: OVERLAY_INK, width: border, alpha: HANDLE_BORDER_ALPHA });
  }
}

/**
 * A bezier tangent handle: hairline arm from the anchor to the handle point,
 * tipped with a small round grab target. Ink-under-white like everything else,
 * thinner than the rope dash so the arm never reads as geometry.
 */
export function drawTangentArm(
  g: Graphics,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  zoom: number,
): void {
  const z = zoom > 0 ? zoom : 1;
  g.moveTo(ax, ay);
  g.lineTo(tx, ty);
  g.stroke({ color: OVERLAY_INK, width: 2.5 / z, alpha: OVERLAY_INK_ALPHA });
  g.moveTo(ax, ay);
  g.lineTo(tx, ty);
  g.stroke({ color: OVERLAY_WHITE, width: 1 / z, alpha: 1 });
  g.circle(tx, ty, 3.5 / z);
  g.fill({ color: OVERLAY_WHITE, alpha: 1 });
  g.stroke({ color: OVERLAY_INK, width: 1.25 / z, alpha: HANDLE_BORDER_ALPHA });
}

/** Small "+" puck marking an insert point on a hovered/idle edge. */
export function drawInsertPuck(g: Graphics, x: number, y: number, zoom: number): void {
  const z = zoom > 0 ? zoom : 1;
  const r = 4.5 / z;
  const arm = 2.2 / z;
  g.circle(x, y, r);
  g.fill({ color: OVERLAY_INK, alpha: 0.8 });
  g.stroke({ color: OVERLAY_WHITE, width: 1 / z, alpha: 0.9 });
  g.moveTo(x - arm, y);
  g.lineTo(x + arm, y);
  g.moveTo(x, y - arm);
  g.lineTo(x, y + arm);
  g.stroke({ color: OVERLAY_WHITE, width: 1 / z, alpha: 1 });
}

/**
 * Dim everything outside the edit so the ring being worked on carries the
 * light. `view` is the camera's world rect; drawn first so handles and dashes
 * land on top. A closed `hole` ring (the floor being edited) stays undimmed;
 * an open wall chain has no interior to spare.
 */
export function drawEditDim(
  g: Graphics,
  view: { x: number; y: number; width: number; height: number },
  hole?: [number, number][],
): void {
  // Fill first, then cut — the same order the region overlay uses; cut()
  // punches out of the previously filled geometry.
  g.rect(view.x, view.y, view.width, view.height);
  g.fill({ color: OVERLAY_INK, alpha: 0.15 });
  if (hole && hole.length >= 3) {
    g.poly(hole.flat(), true);
    g.cut();
  }
}
