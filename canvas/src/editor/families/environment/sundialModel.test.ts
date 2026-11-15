import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { SUN_RISE, sunAt } from '@dnd/core/src/shared/world';
import { RAIL_W } from '@/editor/surfaces/Rail';
import { SHEET_W } from '@/editor/surfaces/SheetFrame';
import { fallbackClearArea, orientationFor, riseAngle, riseLabel, snapCompass, sundialFrame, turnSun } from './sundialModel';

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

describe('the ring', () => {
  it('is centred on the clear area, its diameter the smaller side less 48 px', () => {
    expect(sundialFrame({ left: 100, top: 20, right: 900, bottom: 620 })).toEqual({ cx: 500, cy: 320, r: (600 - 48) / 2 });
    expect(sundialFrame({ left: 0, top: 0, right: 300, bottom: 700 })).toEqual({ cx: 150, cy: 350, r: (300 - 48) / 2 });
  });

  it('depends on the area alone: the same area gives the same ring', () => {
    const area = { left: 56, top: 40, right: 800, bottom: 560 };
    expect(sundialFrame(area)).toEqual(sundialFrame({ ...area }));
  });

  it('is null for a degenerate area', () => {
    expect(sundialFrame({ left: 100, top: 0, right: 100, bottom: 500 })).toBeNull();
    expect(sundialFrame({ left: 500, top: 0, right: 100, bottom: 500 })).toBeNull();
    expect(sundialFrame({ left: 0, top: 300, right: 500, bottom: 300 })).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 48, bottom: 500 })).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 40, bottom: 40 })).toBeNull();
    expect(sundialFrame({ left: 0, top: 0, right: 49, bottom: 49 })).not.toBeNull();
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
