import { describe, expect, it } from 'vitest';
import { battlemapCells, parseSizeHint, pickedImageLine } from './battlemapSize';

describe('parseSizeHint', () => {
  it('reads W x H in its spellings', () => {
    expect(parseSizeHint('Crypt 36x24.jpg')).toEqual({ width: 36, height: 24 });
    expect(parseSizeHint('crypt_36 x 24_day.png')).toEqual({ width: 36, height: 24 });
    expect(parseSizeHint('Forest-30×40.webp')).toEqual({ width: 30, height: 40 });
    expect(parseSizeHint('TAVERN 22X16.png')).toEqual({ width: 22, height: 16 });
  });

  it('takes the first hint in the name', () => {
    expect(parseSizeHint('tower 20x20 (v2 10x10).png')).toEqual({ width: 20, height: 20 });
  });

  it('does not read pixel sizes or nonsense as squares', () => {
    expect(parseSizeHint('map_2520x1680.png')).toBeNull();
    expect(parseSizeHint('cellar.png')).toBeNull();
    expect(parseSizeHint('road 0x12.png')).toBeNull();
    expect(parseSizeHint('box.png')).toBeNull();
  });
});

describe('battlemapCells', () => {
  const px = { width: 2520, height: 1680 };

  it('prefers the name hint over everything', () => {
    expect(battlemapCells(px, { width: 36, height: 24 }, { pxPerCell: 100, confidence: 0.9 })).toEqual({
      width: 36,
      height: 24,
      source: 'hint',
    });
  });

  it('uses a confident detection when there is no hint', () => {
    expect(battlemapCells(px, null, { pxPerCell: 105, confidence: 0.8 })).toEqual({ width: 24, height: 16, source: 'detected' });
  });

  it('falls back to 70 px a square for a weak detection or none', () => {
    expect(battlemapCells(px, null, { pxPerCell: 105, confidence: 0.3 })).toEqual({ width: 36, height: 24, source: 'guess' });
    expect(battlemapCells(px, null)).toEqual({ width: 36, height: 24, source: 'guess' });
  });

  it('never goes below one square', () => {
    expect(battlemapCells({ width: 20, height: 10 }, null)).toEqual({ width: 1, height: 1, source: 'guess' });
  });
});

describe('pickedImageLine', () => {
  it('reads pixels then squares', () => {
    expect(pickedImageLine({ width: 2520, height: 1680 }, { width: 36, height: 24 })).toBe('2520 × 1680 px · 36 × 24 squares');
  });
});
