import { describe, it, expect } from 'vitest';
import { HANDLE_OUTSET, SMALL_BOX_PX, TransformGizmo } from './TransformGizmo';

// The chip label measures text through a 2D context jsdom does not have (see SelectTool.test.ts).
if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
const fakeCtx2D = new Proxy(
  {},
  {
    get: (target: Record<string, unknown>, prop) =>
      prop in target ? target[prop as string] : () => ({ width: 0, height: 0 }),
    set: (target: Record<string, unknown>, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = (() => fakeCtx2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

const gizmoOn = (width: number, height: number) => {
  const g = new TransformGizmo();
  g.update({ x: 100, y: 100, width, height }, { showRotate: true, chip: null, rotation: 0 });
  return g;
};

describe('TransformGizmo handles', () => {
  it('a box under 28 px keeps its inside for moving: no handle there, the corners stand off it', () => {
    const g = gizmoOn(12, 12);
    // Every point inside the box misses the handles, so the press goes to the child (a move).
    for (const [x, y] of [[101, 101], [106, 106], [111, 111], [101, 111], [111, 101]]) {
      expect(g.hitTest(x, y)).toBeNull();
    }
    expect(g.hitTest(100 - HANDLE_OUTSET, 100 - HANDLE_OUTSET)).toBe('nw');
    expect(g.hitTest(112 + HANDLE_OUTSET, 112 + HANDLE_OUTSET)).toBe('se');
    expect(g.hitTest(106, 100 - HANDLE_OUTSET - 20)).toBe('rotate');
  });

  it('small in one axis is enough to push them out', () => {
    const g = gizmoOn(120, SMALL_BOX_PX - 1);
    expect(g.hitTest(110, 110)).toBeNull();
    expect(g.hitTest(160, 100 - HANDLE_OUTSET)).toBe('n');
  });

  it('a box of 28 px and more keeps its handles on its corners', () => {
    const g = gizmoOn(SMALL_BOX_PX, SMALL_BOX_PX);
    expect(g.hitTest(100, 100)).toBe('nw');
    expect(g.hitTest(128, 128)).toBe('se');
  });
});
