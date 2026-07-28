import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { analyzeSprite, computeTileableEdges } from './analyze.js';

async function makeSolidPng(
  w: number,
  h: number,
  r = 128,
  g = 128,
  b = 128,
): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function makeWithTransparentBorder(
  w: number,
  h: number,
): Promise<Buffer> {
  const inner = await sharp({
    create: {
      width: w - 20,
      height: h - 20,
      channels: 4,
      background: { r: 200, g: 100, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: inner, left: 10, top: 10 }])
    .png()
    .toBuffer();
}

describe('analyzeSprite', () => {
  it('returns correct content bounds for solid image', async () => {
    const buf = await makeSolidPng(200, 200);
    const result = await analyzeSprite(buf);
    expect(result.contentBounds).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it('detects trimmed content bounds for image with transparent border', async () => {
    const buf = await makeWithTransparentBorder(200, 200);
    const result = await analyzeSprite(buf);
    expect(result.contentBounds.x).toBeGreaterThan(0);
    expect(result.contentBounds.y).toBeGreaterThan(0);
    expect(result.contentBounds.w).toBeLessThan(200);
  });

  it('returns width and height', async () => {
    const buf = await makeSolidPng(300, 150);
    const result = await analyzeSprite(buf);
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
  });
});

describe('computeTileableEdges', () => {
  it('detects identical images as tileable on all edges', async () => {
    const buf = await makeSolidPng(200, 200, 100, 100, 100);
    const edges = await computeTileableEdges(buf, buf);
    expect(edges.leftRight).toBe(true);
    expect(edges.topBottom).toBe(true);
  });

  it('detects very different images as not tileable', async () => {
    const white = await makeSolidPng(200, 200, 255, 255, 255);
    const black = await makeSolidPng(200, 200, 0, 0, 0);
    const edges = await computeTileableEdges(white, black);
    expect(edges.leftRight).toBe(false);
    expect(edges.topBottom).toBe(false);
  });
});
