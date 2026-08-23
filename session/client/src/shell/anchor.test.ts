import { describe, expect, it } from 'vitest';
import { boundsOf, GAP, NOTCH_REST, placeBeside } from './anchor';

// A generous map, matching what `DoorMenu.test.tsx`/`TokenMenu.test.tsx` mock.
const BOUNDS = boundsOf({ width: 800, height: 600 }); // {left:12, top:12, right:788, bottom:560}
const MENU = { width: 180, height: 76 };

describe('boundsOf', () => {
  it('clamps to the map rect minus the status bar and a 12px margin on every side', () => {
    expect(boundsOf({ width: 800, height: 600 })).toEqual({ left: 12, top: 12, right: 788, bottom: 560 });
  });
});

describe('placeBeside', () => {
  it('sits right of the anchor, vertically centred, with the resting notch, when there is room', () => {
    const p = placeBeside({ x: 100, y: 50 }, MENU, BOUNDS);
    expect(p).toEqual({ left: 100 + GAP, top: 50 - MENU.height / 2, side: 'right', notchTop: NOTCH_REST });
  });

  it('flips to the left of the anchor when the right side would run past the bounds', () => {
    // Anchor near the right edge — placing right of it (width 180) overflows `bounds.right`.
    const p = placeBeside({ x: 750, y: 50 }, MENU, BOUNDS);
    expect(p.side).toBe('left');
    expect(p.left).toBe(750 - GAP - MENU.width);
    expect(p.notchTop).toBe(NOTCH_REST);
  });

  it('clamps in place and hides the notch when neither side has room', () => {
    // Bounds narrower than the menu itself: right of the anchor overflows, and left of it
    // runs past `bounds.left` too.
    const tightBounds = { left: 12, top: 12, right: 100, bottom: 560 };
    const p = placeBeside({ x: 50, y: 50 }, MENU, tightBounds);
    expect(p.notchTop).toBeNull();
    expect(p.left).toBeGreaterThanOrEqual(tightBounds.left);
    expect(p.left).toBeLessThanOrEqual(Math.max(tightBounds.left, tightBounds.right - MENU.width));
  });

  it('clamps to the bottom bound (the status bar) and moves the notch to the anchor’s y', () => {
    // Anchor near the bottom of the map — centring the menu on it would push it under the
    // status bar, so top clamps to `bounds.bottom - height`.
    const p = placeBeside({ x: 100, y: 545 }, MENU, BOUNDS);
    expect(p.top).toBe(BOUNDS.bottom - MENU.height); // 560 - 76 = 484
    // The anchor sits `545 - 484 = 61px` down from that clamped top.
    expect(p.notchTop).toBe(61);
  });

  it('clamps to the top bound and moves the notch up to the anchor’s y', () => {
    const p = placeBeside({ x: 100, y: 20 }, MENU, BOUNDS);
    expect(p.top).toBe(BOUNDS.top); // 12
    // Anchor sits 8px down from the clamped top — clamped up to the notch's own margin (10).
    expect(p.notchTop).toBe(10);
  });

  it('never lets the notch touch the menu’s rounded corners even at an extreme clamp', () => {
    const p = placeBeside({ x: 100, y: -1000 }, MENU, BOUNDS);
    expect(p.notchTop).toBeGreaterThanOrEqual(10);
    expect(p.notchTop).toBeLessThanOrEqual(MENU.height - 10);
  });
});
