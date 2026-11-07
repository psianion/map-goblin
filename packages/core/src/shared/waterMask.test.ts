import { describe, expect, it } from 'vitest';
import {
  WATER_TEXELS_PER_CELL as T,
  decodeWater,
  emptyWaterGrid,
  encodeWater,
  paintWaterDisc,
  waterBlendAt,
  waterBounds,
  waterDistance,
  waterPixels,
  type WaterGrid,
  type WaterLook,
} from './waterMask';

const look: WaterLook = { shallow: '#9db7bd', deep: '#5f8a93', blend: 1, border: false };
const wet = (g: WaterGrid) => g.data.reduce((n, v) => n + v, 0);
const at = (g: WaterGrid, cx: number, cy: number) => g.data[(Math.floor(cy * T) - g.y) * g.w + (Math.floor(cx * T) - g.x)];

describe('water mask', () => {
  it('paints a disc of the brush radius, and grows the grid to hold it', () => {
    const g = paintWaterDisc(emptyWaterGrid(), 5, 5, 2, false);
    expect(g.w).toBe(4 * T);
    expect(at(g, 5, 5)).toBe(1);
    expect(at(g, 6.9, 5)).toBe(1);
    expect(at(g, 6.6, 6.6)).toBe(0);
    // The disc's area, within a texel's rim.
    expect(wet(g) / (T * T)).toBeCloseTo(Math.PI * 4, 0);
    const more = paintWaterDisc(g, 10, 5, 1, false);
    expect(more.x).toBe(g.x);
    expect(more.w).toBe(8 * T);
    expect(at(more, 5, 5)).toBe(1);
    expect(at(more, 10, 5)).toBe(1);
  });

  it('erase dries what it covers and never grows the grid', () => {
    const g = paintWaterDisc(emptyWaterGrid(), 0, 0, 2, false);
    const w = g.w;
    const dried = paintWaterDisc(g, 2, 0, 1, true);
    expect(dried.w).toBe(w);
    expect(at(dried, 1.5, 0)).toBe(0);
    expect(at(dried, -1, 0)).toBe(1);
    const nothing = paintWaterDisc(emptyWaterGrid(), 0, 0, 2, true);
    expect(nothing.w).toBe(0);
  });

  it('saves trimmed to the wet texels and loads back the same mask', () => {
    let g = paintWaterDisc(emptyWaterGrid(), 3, 3, 1.5, false);
    g = paintWaterDisc(g, 8, 3, 1, false);
    g = paintWaterDisc(g, 8, 3, 1.5, true);
    const body = encodeWater(g, look)!;
    expect(body).toMatchObject(look);
    expect(body.w).toBe(3 * T);
    const back = decodeWater(body);
    expect(wet(back)).toBe(wet(g));
    expect(encodeWater(back, look)).toEqual(body);
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
    expect(waterBounds(body)).toEqual({ minX: 1.5, minY: 1.5, maxX: 4.5, maxY: 4.5 });
  });

  it('saves a dry mask as nothing', () => {
    const g = paintWaterDisc(paintWaterDisc(emptyWaterGrid(), 0, 0, 1, false), 0, 0, 2, true);
    expect(encodeWater(g, look)).toBeNull();
    expect(decodeWater(null).w).toBe(0);
  });

  it('measures each wet texel from the edge', () => {
    const g = paintWaterDisc(emptyWaterGrid(), 0, 0, 3, false);
    const d = waterDistance(g);
    const centre = d[(0 - g.y) * g.w + (0 - g.x)];
    expect(centre).toBeGreaterThan(2.5 * T);
    expect(centre).toBeLessThan(3.2 * T);
    // A texel on the rim is one in.
    const rim = d[(0 - g.y) * g.w + (Math.floor(2.95 * T) - g.x)];
    expect(rim).toBe(1);
  });

  it('blends Shallow at the edge to Deep over the blend distance', () => {
    expect(waterBlendAt(0.5, 2)).toBe(0);
    expect(waterBlendAt(0.5 + T, 2)).toBeCloseTo(0.5);
    expect(waterBlendAt(0.5 + 2 * T, 2)).toBe(1);
    expect(waterBlendAt(40, 2)).toBe(1);
    // No blend distance: Deep throughout.
    expect(waterBlendAt(1, 0)).toBe(1);
  });

  it('draws the rim Shallow, the middle Deep, and the border Deep along the edge', () => {
    const g = paintWaterDisc(emptyWaterGrid(), 0, 0, 3, false);
    const px = (p: Uint8ClampedArray, width: number, cx: number, cy: number) => {
      const o = ((Math.floor(cy * T) - g.y + 1) * width + (Math.floor(cx * T) - g.x + 1)) * 4;
      return [p[o], p[o + 1], p[o + 2], p[o + 3]];
    };
    const plain = waterPixels(g, look);
    expect(plain.width).toBe(g.w + 2);
    expect(px(plain.pixels, plain.width, 0, 0)).toEqual([0x5f, 0x8a, 0x93, 255]);
    const rim = px(plain.pixels, plain.width, 2.95, 0);
    expect(rim[0]).toBeGreaterThan(0x95);
    expect(rim[3]).toBe(255);
    expect(px(plain.pixels, plain.width, 2.9, 2.9)[3]).toBe(0);
    const bordered = waterPixels(g, { ...look, border: true });
    expect(px(bordered.pixels, bordered.width, 2.95, 0)).toEqual([0x5f, 0x8a, 0x93, 255]);
    // Changing Deep changes the middle.
    const red = waterPixels(g, { ...look, deep: '#ff0000' });
    expect(px(red.pixels, red.width, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});
