import { describe, it, expect } from 'vitest';
import {
  computeExportDimensions,
  buildExportFilename,
  worldBoundsToCells,
} from './exportMath';

describe('computeExportDimensions', () => {
  it('returns exact pixels for normal maps', () => {
    const result = computeExportDimensions(10, 8, 64);
    expect(result.widthPx).toBe(640);
    expect(result.heightPx).toBe(512);
    expect(result.clampedToLimit).toBe(false);
  });

  it('shrinks a wide map to 8192 without cropping — both axes, one scale', () => {
    const result = computeExportDimensions(100, 8, 256);
    expect(result.widthPx).toBe(8192);
    expect(result.heightPx).toBe(Math.round(8 * 81.92));
    expect(result.pxPerCell).toBeCloseTo(81.92, 5);
    expect(result.clampedToLimit).toBe(true);
  });

  it('shrinks a tall map to 8192 the same way', () => {
    const result = computeExportDimensions(8, 100, 256);
    expect(result.heightPx).toBe(8192);
    expect(result.widthPx).toBe(Math.round(8 * 81.92));
    expect(result.clampedToLimit).toBe(true);
  });

  it('keeps the requested scale when nothing is clamped', () => {
    expect(computeExportDimensions(47, 42, 128).pxPerCell).toBe(128);
  });

  it('renders the whole of a 47×42 map at 300 px/cell inside the limit', () => {
    // The case that used to export the top-left 58% of an imported battlemap.
    const result = computeExportDimensions(47, 42, 300);
    expect(result.widthPx).toBe(8192);
    expect(result.heightPx).toBe(Math.round(42 * (8192 / 47)));
    expect(result.widthPx / result.pxPerCell).toBeCloseTo(47, 6);
  });

  it('handles 1x1 map', () => {
    const result = computeExportDimensions(1, 1, 256);
    expect(result.widthPx).toBe(256);
    expect(result.heightPx).toBe(256);
    expect(result.clampedToLimit).toBe(false);
  });

  it('ceil-rounds fractional cells', () => {
    const result = computeExportDimensions(3.5, 2.3, 100);
    expect(result.widthPx).toBe(400);
    expect(result.heightPx).toBe(300);
  });
});

describe('buildExportFilename', () => {
  it('builds standard filename', () => {
    expect(buildExportFilename('My Map', 1024, 768, 128, 'png')).toBe(
      'My-Map-1024x768-128ppc.png',
    );
  });

  it('handles JPEG format', () => {
    expect(buildExportFilename('dungeon', 640, 480, 64, 'jpeg')).toBe(
      'dungeon-640x480-64ppc.jpeg',
    );
  });

  it('uses "map" when name is empty', () => {
    expect(buildExportFilename('  ', 512, 512, 256, 'png')).toBe(
      'map-512x512-256ppc.png',
    );
  });

  it('replaces slashes and backslashes', () => {
    expect(buildExportFilename('floor/1\\2', 100, 100, 64, 'png')).toBe(
      'floor-1-2-100x100-64ppc.png',
    );
  });
});

describe('worldBoundsToCells', () => {
  it('converts world bounds to cell counts', () => {
    const result = worldBoundsToCells({ minX: 0, minY: 0, maxX: 10, maxY: 8 });
    expect(result.cellWidth).toBe(10);
    expect(result.cellHeight).toBe(8);
  });

  it('ceil-rounds fractional world sizes', () => {
    const result = worldBoundsToCells({ minX: 0.5, minY: 0, maxX: 10.3, maxY: 8.1 });
    expect(result.cellWidth).toBe(10);
    expect(result.cellHeight).toBe(9);
  });

  it('returns at least 1 for degenerate bounds', () => {
    const result = worldBoundsToCells({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(result.cellWidth).toBe(1);
    expect(result.cellHeight).toBe(1);
  });
});
