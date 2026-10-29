import { describe, it, expect } from 'vitest';
import { placePopover } from './popPlacement';

describe('placePopover', () => {
  const view = { width: 1280, height: 720 };
  const size = { width: 210, height: 200 };
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

  it('above: clears the trigger by 20px with left edges lined up', () => {
    expect(placePopover('above', box(600, 620, 40, 20), box(600, 620, 40, 20), size, view)).toEqual({ left: 592, top: 400 });
  });

  it('above: drops below the trigger when the top has no room, and stays inside the right edge', () => {
    expect(placePopover('above', box(1200, 40, 40, 20), box(1200, 40, 40, 20), size, view)).toEqual({ left: 1062, top: 68 });
  });

  it('beside: left of the card, level with the trigger', () => {
    const card = box(996, 68, 272, 400);
    expect(placePopover('beside', box(1008, 160, 248, 28), card, size, view)).toEqual({ left: 778, top: 148 });
  });

  it('beside: never runs past the bottom of the viewport', () => {
    const card = box(996, 68, 272, 492);
    expect(placePopover('beside', box(1008, 600, 248, 28), card, size, view).top).toBe(720 - 200 - 8);
  });

  it('beside: moves right of the card when the left has no room', () => {
    const card = box(20, 68, 272, 400);
    expect(placePopover('beside', box(30, 160, 248, 28), card, size, view).left).toBe(300);
  });
});
