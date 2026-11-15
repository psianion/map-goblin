import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { SUN_RISE, sunAt } from '@dnd/core/src/shared/world';
import { RAIL_W } from '@/editor/surfaces/Rail';
import { SHEET_W } from '@/editor/surfaces/SheetFrame';
import { MAP_GAP, fallbackClearArea, mapCircle, orientationFor, riseAngle, riseLabel, snapCompass, sundialFit, sundialFrame, turnSun } from './sundialModel';

const st = () => useStore.getState();

describe('the rise angle', () => {
  it('is where sunAt puts the sun at sunrise, for every orientation', () => {
    for (let o = 0; o < 360; o += 15) {
      expect(riseAngle(o)).toBeCloseTo(sunAt(SUN_RISE, { naturalLight: true, orientation: o }, 'full-moon').azimuth, 9);
    }
  });

  it('round-trips through the orientation for every whole degree off the compass points', () => {
    for (let o = 0; o < 360; o++) {
      const angle = riseAngle(o);
      const snapped = snapCompass(angle);
      // Inside a snap window the handle lands on the compass point; elsewhere it stays put.
      expect(orientationFor(angle)).toBe(Math.round((((snapped - riseAngle(0)) % 360) + 360) % 360) % 360);
      if (snapped === angle) expect(orientationFor(angle)).toBe(o);
    }
  });

  it('puts dawn light at the handle: the sun rises at the handle’s own angle', () => {
    for (const o of [0, 45, 90, 200, 333]) {
      const o2 = orientationFor(riseAngle(o));
      expect(riseAngle(o2)).toBeCloseTo(sunAt(SUN_RISE, { naturalLight: true, orientation: o2 }, 'full-moon').azimuth, 9);
    }
  });
});

describe('snapping to the eight compass points', () => {
  it('snaps within 6 degrees of a point, either side', () => {
    for (let p = 0; p < 360; p += 45) {
      expect(snapCompass(p + 6)).toBe(p % 360);
      expect(snapCompass(p - 6)).toBe(p % 360);
      expect(snapCompass(p + 2.5)).toBe(p % 360);
    }
  });

  it('leaves an angle further than 6 degrees from every point alone', () => {
    for (let p = 0; p < 360; p += 45) {
      expect(snapCompass(p + 6.5)).toBeCloseTo(p + 6.5, 9);
      expect(snapCompass(p + 22.5)).toBeCloseTo(p + 22.5, 9);
      expect(snapCompass(p - 6.5)).toBeCloseTo(((p - 6.5) + 360) % 360, 9);
    }
  });

  it('wraps: -3 degrees is the right-hand point', () => {
    expect(snapCompass(-3)).toBe(0);
    expect(snapCompass(363)).toBe(0);
    expect(snapCompass(720 + 47)).toBe(45);
  });

  it('gives a whole-degree orientation', () => {
    for (const a of [1, 17.4, 133.7, 250.2, 359.9]) {
      const o = orientationFor(a);
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(360);
    }
  });
});

describe('the readout wording', () => {
  it('names the screen side the sun rises at, to the nearest compass point', () => {
    const at = (angle: number) => riseLabel(orientationFor(angle));
    expect([0, 45, 90, 135, 180, 225, 270, 315].map(at)).toEqual([
      'Rise at the right',
      'Rise at the lower right',
      'Rise at the bottom',
      'Rise at the lower left',
      'Rise at the left',
      'Rise at the upper left',
      'Rise at the top',
      'Rise at the upper right',
    ]);
  });

  it('rounds to the nearest point between two', () => {
    expect(riseLabel(orientationFor(100))).toBe('Rise at the bottom');
    expect(riseLabel(orientationFor(130))).toBe('Rise at the lower left');
  });
});

describe('the map circle', () => {
  it('is centred on the map’s bounds, half their diagonal plus 2 squares, through the camera', () => {
    // A 6 by 8 map: diagonal 10, so 5 + 2 = 7 squares; at 20 px a square, offset (100, 50).
    const c = mapCircle({ minX: 0, minY: 0, maxX: 6, maxY: 8 }, { x: 100, y: 50, zoom: 20 });
    expect(c).toEqual({ cx: 100 + 3 * 20, cy: 50 + 4 * 20, r: 7 * 20 });
    expect(MAP_GAP).toBe(2);
  });

  it('keeps every corner inside with 2 squares of air', () => {
    const b = { minX: -7, minY: 3, maxX: 15, maxY: 11 };
    const cam = { x: -40, y: 12, zoom: 33 };
    const c = mapCircle(b, cam);
    for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]] as const) {
      const d = Math.hypot(x * cam.zoom + cam.x - c.cx, y * cam.zoom + cam.y - c.cy);
      expect(c.r - d).toBeCloseTo(MAP_GAP * cam.zoom, 6);
    }
  });

  it('follows pan and zoom', () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const a = mapCircle(b, { x: 0, y: 0, zoom: 10 });
    const panned = mapCircle(b, { x: 30, y: -20, zoom: 10 });
    expect([panned.cx - a.cx, panned.cy - a.cy, panned.r]).toEqual([30, -20, a.r]);
    expect(mapCircle(b, { x: 0, y: 0, zoom: 20 }).r).toBe(a.r * 2);
  });
});

describe('the ring', () => {
  const area = { left: 100, top: 20, right: 900, bottom: 620 };
  // The largest ring here: centre (500, 320), radius (600 - 48) / 2.
  const FIT = { cx: 500, cy: 320, r: 276 };

  it('the largest is centred on the clear area, its diameter the smaller side less 48 px', () => {
    expect(sundialFit(area)).toEqual(FIT);
    expect(sundialFit({ left: 0, top: 0, right: 300, bottom: 700 })).toEqual({ cx: 150, cy: 350, r: (300 - 48) / 2 });
  });

  it('is the map circle, with no shadow, while that fits', () => {
    const map = { cx: 450, cy: 300, r: 200 };
    expect(sundialFrame(area, map)).toEqual({ ...map, shadow: 0 });
  });

  it('is the largest ring, resting at the borders, once the map outgrows it, with the shadow eased in', () => {
    const at = (r: number) => sundialFrame(area, { cx: 500, cy: 320, r })!;
    expect(at(FIT.r)).toEqual({ ...FIT, shadow: 0 });
    // Clamping starts: the shadow grows with how far the map outgrows the ring, not all at once.
    const s1 = at(FIT.r * 1.03).shadow;
    const s2 = at(FIT.r * 1.08).shadow;
    expect(s1).toBeGreaterThan(0);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(1);
    expect(at(FIT.r * 3)).toEqual({ ...FIT, shadow: 1 });
  });

  it('keeps the whole ring inside the clear area when the map is panned off it', () => {
    for (const map of [{ cx: -400, cy: 320, r: 150 }, { cx: 2000, cy: 900, r: 150 }, { cx: 500, cy: -50, r: 5000 }]) {
      const f = sundialFrame(area, map)!;
      expect(f.cx - f.r).toBeGreaterThanOrEqual(area.left + 24 - 1e-9);
      expect(f.cx + f.r).toBeLessThanOrEqual(area.right - 24 + 1e-9);
      expect(f.cy - f.r).toBeGreaterThanOrEqual(area.top + 24 - 1e-9);
      expect(f.cy + f.r).toBeLessThanOrEqual(area.bottom - 24 + 1e-9);
    }
    // On the tight axis a full-size ring sits at the area's centre; on the loose one it follows.
    const big = sundialFrame(area, { cx: 300, cy: 100, r: 1000 })!;
    expect(big.cy).toBe(FIT.cy);
    expect(big.cx).toBe(100 + 24 + FIT.r);
  });

  it('moves continuously through zoom and pan: no jump between fitting and resting', () => {
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 12 };
    let prev: ReturnType<typeof sundialFrame> = null;
    // Zoom in about a point while panning, in small steps, across the clamp.
    for (let zoom = 5; zoom <= 60; zoom += 0.05) {
      const f = sundialFrame(area, mapCircle(bounds, { x: 500 - 10 * zoom + (zoom - 5) * 3, y: 320 - 6 * zoom, zoom }))!;
      if (prev) {
        expect(Math.abs(f.r - prev.r)).toBeLessThan(1);
        expect(Math.abs(f.cx - prev.cx)).toBeLessThan(1);
        expect(Math.abs(f.cy - prev.cy)).toBeLessThan(1);
        expect(Math.abs(f.shadow - prev.shadow)).toBeLessThan(0.05);
      }
      prev = f;
    }
    expect(prev!.r).toBe(FIT.r);
  });

  it('is the largest ring with no shadow while there is no camera', () => {
    expect(sundialFrame(area, null)).toEqual({ ...FIT, shadow: 0 });
  });

  it('is null for a degenerate area', () => {
    const map = { cx: 0, cy: 0, r: 10 };
    expect(sundialFrame({ left: 100, top: 0, right: 100, bottom: 500 }, map)).toBeNull();
    expect(sundialFrame({ left: 500, top: 0, right: 100, bottom: 500 }, map)).toBeNull();
    expect(sundialFrame({ left: 0, top: 300, right: 500, bottom: 300 }, map)).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 48, bottom: 500 }, map)).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 40, bottom: 40 }, null)).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 49, bottom: 49 }, map)).not.toBeNull();
  });

  it('falls back to the window less the rail and the sheet', () => {
    const area = fallbackClearArea({ width: 1280, height: 800 });
    expect(area.left).toBe(RAIL_W);
    expect(area.top).toBe(0);
    expect(area.bottom).toBe(800);
    expect(area.right).toBe(1280 - SHEET_W - 12);
  });
});

describe('turning the sun', () => {
  beforeEach(() => {
    undoManager.clear();
    st().resetToDefault();
  });

  it('writes the orientation in whole degrees, wrapped', () => {
    turnSun(-30.4);
    expect(st().mapSettings.orientation).toBe(330);
    turnSun(725);
    expect(st().mapSettings.orientation).toBe(5);
  });

  it('writes nothing when the orientation is already there', () => {
    turnSun(0);
    expect(undoManager.size()).toBe(0);
    turnSun(90);
    turnSun(90);
    expect(undoManager.size()).toBe(1);
  });

  it('folds a coalesced drag into one undo step, and undoes to where it started', () => {
    turnSun(10);
    undoManager.clear();
    for (const o of [20, 35, 50, 80, 120]) turnSun(o, 'sky.orientation');
    expect(st().mapSettings.orientation).toBe(120);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(st().mapSettings.orientation).toBe(10);
    undoManager.redo();
    expect(st().mapSettings.orientation).toBe(120);
  });

  it('keeps uncoalesced turns as separate steps', () => {
    turnSun(45);
    turnSun(90);
    expect(undoManager.size()).toBe(2);
  });
});
