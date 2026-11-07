import { describe, expect, it } from 'vitest';
import {
  WATER_TEXELS_PER_CELL as T,
  belowWaterTint,
  decodeWater,
  emptyWaterGrid,
  encodeWater,
  paintWaterDisc,
  waterBlendAt,
  waterBounds,
  waterColourAt,
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

describe('below-water tint', () => {
  // A pool of radius 3 at (5, 5), blend 2 cells: Shallow at its rim, Deep from two cells in.
  const pool = encodeWater(paintWaterDisc(emptyWaterGrid(), 5, 5, 3, false), { shallow: '#c0c0c0', deep: '#204060', blend: 2, border: false })!;

  it('takes Deep in the middle of the water: the prop tint times Deep', () => {
    expect(waterColourAt(pool, 5, 5)).toEqual([0x20, 0x40, 0x60]);
    expect(belowWaterTint('#ffffff', [pool], 5, 5)).toBe('#204060');
    // Its own tint multiplies in: half red stays half of Deep's red.
    expect(belowWaterTint('#800000', [pool], 5, 5)).toBe('#100000');
  });

  it('takes Shallow at the edge, with the renderer\'s blend in between', () => {
    const rim = waterColourAt(pool, 7.95, 5)!;
    // A rim texel is half a texel into the blend: all but Shallow.
    expect(rim[0]).toBeGreaterThan(0xb8);
    const half = waterColourAt(pool, 7, 5)!;
    expect(half[0]).toBeLessThan(rim[0]);
    expect(half[0]).toBeGreaterThan(0x20);
    // The same colour the water's own pixels hold there.
    const g = decodeWater(pool);
    const { width, pixels } = waterPixels(g, pool);
    const tx = Math.floor(7 * T) - g.x;
    const ty = Math.floor(5 * T) - g.y;
    expect(pixels[((ty + 1) * width + (tx + 1)) * 4]).toBe(half[0]);
  });

  it('draws as it is where there is no water, or past the edge', () => {
    expect(waterColourAt(undefined, 5, 5)).toBeNull();
    expect(waterColourAt(pool, 8.5, 5)).toBeNull();
    expect(belowWaterTint('#a0b0c0', [], 5, 5)).toBe('#a0b0c0');
    expect(belowWaterTint('#a0b0c0', [pool], 20, 20)).toBe('#a0b0c0');
  });

  it('reads the topmost wet water first', () => {
    const red = encodeWater(paintWaterDisc(emptyWaterGrid(), 5, 5, 1, false), { shallow: '#ff0000', deep: '#ff0000', blend: 0, border: false })!;
    expect(belowWaterTint('#ffffff', [red, pool], 5, 5)).toBe('#ff0000');
    expect(belowWaterTint('#ffffff', [red, pool], 7, 5)).not.toBe('#ff0000');
  });
});
