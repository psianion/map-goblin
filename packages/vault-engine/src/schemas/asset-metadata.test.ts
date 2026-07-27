import { describe, it, expect } from 'vitest';
import { AssetMetadataSchema, GridSizeSchema } from './asset-metadata.js';

describe('GridSizeSchema', () => {
  it('accepts "1x1"', () => {
    expect(GridSizeSchema.safeParse('1x1').success).toBe(true);
  });

  it('accepts "3x2"', () => {
    expect(GridSizeSchema.safeParse('3x2').success).toBe(true);
  });

  it('rejects "abc"', () => {
    expect(GridSizeSchema.safeParse('abc').success).toBe(false);
  });

  it('rejects "0x1"', () => {
    expect(GridSizeSchema.safeParse('0x1').success).toBe(false);
  });
});

describe('AssetMetadataSchema', () => {
  const VALID = {
    id: 'stone-cobble_1x1_floor_A',
    sourceFile: 'floors/stone-cobble-A.png',
    type: 'floor',
    theme: 'dungeon',
    material: 'stone-cobble',
    gridSize: '1x1',
    pieceType: 'base',
    variant: 'A',
    tint: '#7a7a6e',
    tool: ['floor-fill'],
    tileable: true,
    transparency: false,
    contentBounds: { x: 0, y: 0, w: 200, h: 200 },
    perceptualHash: 'a1b2c3d4e5f6a7b8',
    width: 200,
    height: 200,
  };

  it('accepts valid metadata', () => {
    expect(AssetMetadataSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects invalid asset type', () => {
    expect(AssetMetadataSchema.safeParse({ ...VALID, type: 'invalid' }).success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _id, ...rest } = VALID;
    expect(AssetMetadataSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-hex tint', () => {
    expect(AssetMetadataSchema.safeParse({ ...VALID, tint: 'not-hex' }).success).toBe(false);
  });

  it('rejects negative dimensions', () => {
    expect(AssetMetadataSchema.safeParse({ ...VALID, width: -1 }).success).toBe(false);
  });
});
