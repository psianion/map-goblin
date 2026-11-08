import { describe, expect, it } from 'vitest';
import { gridDivision, gridImages, gridLineSet, imageGridLines } from './imageGridRenderer';
import type { AssetChild } from '../store/types';

const picture = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'img', name: 'Battlemap', childType: 'asset', visible: true, objectType: 'image', assetId: 'pic',
  position: { x: 17.7, y: 11.6 }, rotation: 0, scale: 0.5, width: 72, height: 48, tint: '#ffffff', flipX: false, flipY: false,
  ...over,
});

describe('imageGridLines', () => {
  it('runs a whole-cell line across the picture for every cell it touches, clipped to its footprint', () => {
    // The picture spans -0.3..35.7 by -0.4..23.6.
    const { clip, lines } = imageGridLines(picture());
    expect(clip[0][0]).toBeCloseTo(-0.3, 9);
    expect(clip[0][1]).toBeCloseTo(-0.4, 9);
    expect(clip[2][0]).toBeCloseTo(35.7, 9);
    const vertical = lines.filter(([a, b]) => a[0] === b[0]).map(([a]) => a[0]);
    const horizontal = lines.filter(([a, b]) => a[1] === b[1]).map(([a]) => a[1]);
    expect(vertical[0]).toBe(-1);
    expect(vertical.at(-1)).toBe(36);
    expect(vertical).toHaveLength(38);
    expect(horizontal[0]).toBe(-1);
    expect(horizontal.at(-1)).toBe(24);
    // Every line sits on a whole map cell.
    for (const [a, b] of lines) for (const v of [...a, ...b]) expect(Number.isInteger(v)).toBe(true);
  });

  it('draws nothing for a picture with no size', () => {
    expect(imageGridLines(picture({ width: 0 }))).toEqual({ clip: [], lines: [], minor: [] });
  });
});

describe('gridImages', () => {
  it('takes shown imported pictures, not props or hidden ones', () => {
    const prop = picture({ id: 'p', objectType: 'asset' });
    const hidden = picture({ id: 'h', visible: false });
    expect(gridImages([picture(), prop, hidden]).map((c) => c.id)).toEqual(['img']);
  });
});

describe('gridLineSet', () => {
  it('puts division - 1 lines between each pair of whole-cell lines, on both axes', () => {
    // 3 by 2 cells: 4 vertical and 3 horizontal whole-cell lines.
    for (const [division, minor] of [[1, 0], [2, 3 + 2], [3, 6 + 4], [4, 9 + 6], [6, 15 + 10], [8, 21 + 14]] as const) {
      const set = gridLineSet(0, 3, 0, 2, division);
      expect(set.major).toHaveLength(7);
      expect(set.minor).toHaveLength(minor);
    }
  });

  it('splits each cell evenly and never draws a subdivision on a whole cell', () => {
    const { minor } = gridLineSet(-1, 1, 0, 1, 4);
    const xs = minor.filter(([a, b]) => a[0] === b[0]).map(([a]) => a[0]);
    expect(xs).toEqual([-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]);
  });

  it('reaches the grid over a picture at the step it is given', () => {
    // -0.3..35.7 by -0.4..23.6: 37 cells across, 25 down, halves.
    const { lines, minor } = imageGridLines(picture(), 2);
    expect(lines).toHaveLength(38 + 26);
    expect(minor).toHaveLength(37 + 25);
  });
});

describe('gridDivision', () => {
  it('is the snap step while snapping, whole cells otherwise', () => {
    expect(gridDivision({ snapEnabled: true, snapDivision: 3 })).toBe(3);
    expect(gridDivision({ snapEnabled: true, snapDivision: 8 })).toBe(8);
    expect(gridDivision({ snapEnabled: false, snapDivision: 4 })).toBe(1);
  });
});
