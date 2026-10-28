import { describe, it, expect } from 'vitest';
import {
  computeBoundingBox,
  applyTransformToPoints,
  constrainProportions,
  rotatePoint,
  snapValueToGrid,
  snapAngle,
  localScaleFor,
  resizeBox,
  type OrientedBox,
} from './transformMath';

describe('computeBoundingBox', () => {
  it('returns correct bounds for a rectangle', () => {
    const points: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const bb = computeBoundingBox(points);
    expect(bb).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('enforces minimum size of 1', () => {
    const points: [number, number][] = [[5, 5], [5, 5]];
    const bb = computeBoundingBox(points);
    expect(bb.width).toBeGreaterThanOrEqual(1);
    expect(bb.height).toBeGreaterThanOrEqual(1);
  });
});

describe('applyTransformToPoints', () => {
  it('applies translate', () => {
    const points: [number, number][] = [[0, 0], [10, 10]];
    const result = applyTransformToPoints(points, { translate: [5, 5], rotate: 0, scale: [1, 1] });
    expect(result).toEqual([[5, 5], [15, 15]]);
  });

  it('applies scale from origin', () => {
    const points: [number, number][] = [[10, 10]];
    const result = applyTransformToPoints(points, { translate: [0, 0], rotate: 0, scale: [2, 2] });
    expect(result).toEqual([[20, 20]]);
  });

  it('applies rotation', () => {
    const points: [number, number][] = [[10, 0]];
    const result = applyTransformToPoints(points, { translate: [0, 0], rotate: Math.PI / 2, scale: [1, 1] });
    expect(result[0][0]).toBeCloseTo(0, 5);
    expect(result[0][1]).toBeCloseTo(10, 5);
  });
});

describe('constrainProportions', () => {
  it('constrains to original aspect ratio', () => {
    const result = constrainProportions(200, 50, 100, 50);
    expect(result.width / result.height).toBeCloseTo(100 / 50);
  });
});

describe('rotatePoint', () => {
  it('rotates 90 degrees around origin', () => {
    const [x, y] = rotatePoint(10, 0, 0, 0, Math.PI / 2);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(10, 5);
  });

  it('rotates around custom pivot', () => {
    const [x, y] = rotatePoint(20, 10, 10, 10, Math.PI);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(10, 5);
  });
});

describe('snapValueToGrid', () => {
  it('snaps to nearest grid line', () => {
    expect(snapValueToGrid(47, 10)).toBe(50);
    expect(snapValueToGrid(3, 10)).toBe(0);
  });
});

describe('snapAngle', () => {
  it('snaps to nearest 15 degree increment', () => {
    const snapped = snapAngle(0.27); // ~15.5 degrees
    expect(snapped).toBeCloseTo(Math.PI / 12, 5); // 15 degrees
  });
});

describe('localScaleFor', () => {
  it('passes the box scale straight through at 0°', () => {
    expect(localScaleFor(0, 2, 3)).toEqual({ su: 2, sv: 3 });
  });

  it("swaps the axes for a quarter-turned child: its width follows the box's height", () => {
    const { su, sv } = localScaleFor(Math.PI / 2, 2, 3);
    expect(su).toBeCloseTo(3);
    expect(sv).toBeCloseTo(2);
  });

  it('scales a turned child uniformly when the box scales uniformly', () => {
    const { su, sv } = localScaleFor(Math.PI / 4, 2, 2);
    expect(su).toBeCloseTo(2);
    expect(sv).toBeCloseTo(2);
  });
});

describe('resizeBox', () => {
  const free = { shift: false, alt: false };
  const box = (b: Partial<OrientedBox>): OrientedBox => ({ cx: 5, cy: 5, w: 4, h: 2, angle: 0, ...b });

  it('grows a quarter-turned box along its own length from its E handle', () => {
    const table = box({ w: 4, h: 1, angle: Math.PI / 2 });
    // The table's own +x points down the screen: dragging down lengthens it.
    const longer = resizeBox(table, 'e', { x: 0, y: 1 }, free, null);
    expect(longer.w).toBeCloseTo(5);
    expect(longer.h).toBeCloseTo(1);
    expect(longer.cx).toBeCloseTo(5);
    expect(longer.cy).toBeCloseTo(5.5);
    // Dragging across the screen does not widen it (the rotated-resize bug).
    const across = resizeBox(table, 'e', { x: 1, y: 0 }, free, null);
    expect(across.w).toBeCloseTo(4);
    expect(across.h).toBeCloseTo(1);
  });

  it('moves the N edge and keeps the S edge', () => {
    const next = resizeBox(box({}), 'n', { x: 0.4, y: -1 }, free, null);
    expect(next.w).toBe(4);
    expect(next.h).toBeCloseTo(3);
    expect(next.cy).toBeCloseTo(4.5);
    expect(next.cx).toBe(5);
  });

  it('keeps the ratio on a corner, and Shift frees it', () => {
    const kept = resizeBox(box({}), 'se', { x: 2, y: 0 }, free, null);
    expect(kept.w).toBeCloseTo(6);
    expect(kept.h).toBeCloseTo(3);
    expect(kept.cx).toBeCloseTo(6);
    expect(kept.cy).toBeCloseTo(5.5);

    const freed = resizeBox(box({}), 'se', { x: 2, y: 0 }, { shift: true, alt: false }, null);
    expect(freed.w).toBeCloseTo(6);
    expect(freed.h).toBeCloseTo(2);
  });

  it('moves one side on an edge, and Shift keeps the ratio about the edge line', () => {
    const one = resizeBox(box({}), 'e', { x: 2, y: 0 }, free, null);
    expect([one.w, one.h]).toEqual([6, 2]);
    const kept = resizeBox(box({}), 'e', { x: 2, y: 0 }, { shift: true, alt: false }, null);
    expect(kept.w).toBeCloseTo(6);
    expect(kept.h).toBeCloseTo(3);
    expect(kept.cy).toBe(5);
  });

  it('grows about the centre with Alt, read on the move itself', () => {
    const next = resizeBox(box({}), 'e', { x: 1, y: 0 }, { shift: false, alt: true }, null);
    expect(next.w).toBeCloseTo(6);
    expect(next.cx).toBe(5);
    // The same drag without Alt pins the W side instead.
    const pinned = resizeBox(box({}), 'e', { x: 1, y: 0 }, free, null);
    expect(pinned.w).toBeCloseTo(5);
    expect(pinned.cx).toBeCloseTo(5.5);
  });

  it('lands the moving edge on the grid at a right angle', () => {
    // Left edge off the grid at 4.25: the right edge snaps, not the size.
    const next = resizeBox(box({ cx: 5.25, w: 2 }), 'e', { x: 0.6, y: 0 }, free, 1);
    expect(next.cx + next.w / 2).toBeCloseTo(7);
    expect(next.cx - next.w / 2).toBeCloseTo(4.25);

    // Quarter-turned: its own +x runs down the screen, so the edge snaps in y.
    const turned = resizeBox(box({ w: 2, h: 1, angle: Math.PI / 2 }), 'e', { x: 0, y: 0.7 }, free, 1);
    expect(turned.w).toBeCloseTo(3);
    expect(turned.cy + turned.w / 2).toBeCloseTo(7);
  });

  it('snaps the size at any other angle', () => {
    const angle = 0.3;
    const d = { x: 0.7 * Math.cos(angle), y: 0.7 * Math.sin(angle) };
    const next = resizeBox(box({ w: 2, angle }), 'e', d, free, 0.5);
    expect(next.w).toBeCloseTo(2.5);
  });

  it('snaps the leading axis of a kept ratio and derives the other', () => {
    // 4 × 2 with its top-left on the grid at (0, 0).
    const next = resizeBox(box({ cx: 2, cy: 1 }), 'se', { x: 1.3, y: 0.1 }, free, 1);
    expect(next.w).toBeCloseTo(5);
    expect(next.h).toBeCloseTo(2.5);
  });

  it('never turns a box inside out', () => {
    const next = resizeBox(box({}), 'e', { x: -10, y: 0 }, free, null);
    expect(next.w).toBeGreaterThan(0);
  });
});
