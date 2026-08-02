import { describe, it, expect } from 'vitest';
import { snapToAngle, smoothChain } from './drawAssist';

describe('snapToAngle', () => {
  it('leaves points already on a 15° multiple alone', () => {
    const p = snapToAngle({ x: 0, y: 0 }, { x: 1, y: 1 }); // 45°
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
  });

  it('rotates to the nearest multiple and preserves distance', () => {
    const anchor = { x: 2, y: 3 };
    const raw = { x: 2 + Math.cos(0.9), y: 3 + Math.sin(0.9) }; // ~51.6°
    const p = snapToAngle(anchor, raw);
    const angle = Math.atan2(p.y - anchor.y, p.x - anchor.x);
    expect(angle).toBeCloseTo((45 * Math.PI) / 180);
    expect(Math.hypot(p.x - anchor.x, p.y - anchor.y)).toBeCloseTo(1);
  });

  it('returns the point unchanged when it sits on the anchor', () => {
    const p = snapToAngle({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(p).toEqual({ x: 1, y: 1 });
  });
});

describe('smoothChain', () => {
  it('returns short chains unchanged', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(smoothChain(pts)).toBe(pts);
  });

  it('keeps exact endpoints and passes through interior anchors', () => {
    const anchors = [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 0 }];
    const out = smoothChain(anchors);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 4, y: 0 });
    // Curve passes through (2,1) — some output point is within simplify epsilon
    const near = out.some((p) => Math.hypot(p.x - 2, p.y - 1) < 0.05);
    expect(near).toBe(true);
    // Actually curved: more points than the input polyline
    expect(out.length).toBeGreaterThan(anchors.length);
  });

  it('collapses collinear input back to its two endpoints', () => {
    const out = smoothChain([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 2, y: 0 });
    expect(out.length).toBe(2);
  });
});
