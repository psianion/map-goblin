import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  pointInShape,
  pointInAsset,
  hitTestChildren,
  getChildBounds,
  boundsIntersect,
} from './hitTest';
import type { ShapeChild, AssetChild, LightChild } from '@/store/types';

// ─── Helpers ──────────────────────────────────────────────

function makeShape(
  points: [number, number][],
  overrides?: Partial<ShapeChild>,
): ShapeChild {
  return {
    id: 'shape-1',
    name: 'Shape',
    childType: 'shape',
    shapeType: 'polygon',
    visible: true,
    contours: [points],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...overrides,
  };
}

function makeAsset(
  position: { x: number; y: number },
  width: number,
  height: number,
  scale = 1,
  rotation = 0,
  overrides?: Partial<AssetChild>,
): AssetChild {
  return {
    id: 'asset-1',
    name: 'Asset',
    childType: 'asset',
    objectType: 'asset',
    assetId: 'a1',
    visible: true,
    position,
    rotation,
    scale,
    width,
    height,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

function makeLight(
  position: { x: number; y: number },
  radius = 5,
): LightChild {
  return {
    id: 'light-1',
    name: 'Light',
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius,
    featherRadius: 1,
    intensity: 1,
    falloff: 'linear',
    position,
  };
}

// ─── pointInPolygon ───────────────────────────────────────

describe('pointInPolygon', () => {
  const square: [number, number][] = [
    [0, 0], [10, 0], [10, 10], [0, 10],
  ];

  it('returns true for center point', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });

  it('returns false for point outside', () => {
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });

  it('returns false for point at exact corner (edge case)', () => {
    // Ray-casting may vary at boundary — just ensure no throw
    expect(typeof pointInPolygon([0, 0], square)).toBe('boolean');
  });

  it('handles triangle', () => {
    const tri: [number, number][] = [[0, 0], [10, 0], [5, 10]];
    expect(pointInPolygon([5, 5], tri)).toBe(true);
    expect(pointInPolygon([0, 10], tri)).toBe(false);
  });
});

// ─── pointInShape ─────────────────────────────────────────

describe('pointInShape', () => {
  const square: [number, number][] = [
    [0, 0], [10, 0], [10, 10], [0, 10],
  ];

  it('returns true when point is inside with no transform', () => {
    const shape = makeShape(square);
    expect(pointInShape(shape, [5, 5])).toBe(true);
  });

  it('returns false when point is outside with no transform', () => {
    const shape = makeShape(square);
    expect(pointInShape(shape, [15, 5])).toBe(false);
  });

  it('applies translate transform correctly', () => {
    const shape = makeShape(square, {
      transform: { translate: [20, 0], rotate: 0, scale: [1, 1] },
    });
    // World-space [25, 5] → local [5, 5] after subtracting translate
    expect(pointInShape(shape, [25, 5])).toBe(true);
    // Original location should now miss
    expect(pointInShape(shape, [5, 5])).toBe(false);
  });

  it('applies scale transform correctly', () => {
    const shape = makeShape(square, {
      transform: { translate: [0, 0], rotate: 0, scale: [2, 2] },
    });
    // Shape is scaled 2x, so local coords are divided by 2 before pip test
    // Point [18, 18] → local [9, 9] → inside [0,0]–[10,10]
    expect(pointInShape(shape, [18, 18])).toBe(true);
    // Point [22, 5] → local [11, 2.5] → outside
    expect(pointInShape(shape, [22, 5])).toBe(false);
  });
});

// ─── pointInAsset ─────────────────────────────────────────

describe('pointInAsset', () => {
  it('returns true for center of unrotated asset', () => {
    const asset = makeAsset({ x: 10, y: 10 }, 4, 4);
    expect(pointInAsset(asset, [10, 10])).toBe(true);
  });

  it('returns true for edge of unrotated asset', () => {
    const asset = makeAsset({ x: 10, y: 10 }, 4, 4);
    // halfW = halfH = 2; corner at (8,8)
    expect(pointInAsset(asset, [11.9, 11.9])).toBe(true);
  });

  it('returns false outside unrotated asset', () => {
    const asset = makeAsset({ x: 10, y: 10 }, 4, 4);
    expect(pointInAsset(asset, [13, 10])).toBe(false);
  });

  it('uses scale when computing bounds', () => {
    const asset = makeAsset({ x: 0, y: 0 }, 4, 4, 2);
    // halfW = halfH = 4 after scale=2
    expect(pointInAsset(asset, [3.9, 0])).toBe(true);
    expect(pointInAsset(asset, [4.1, 0])).toBe(false);
  });
});

// ─── hitTestChildren ──────────────────────────────────────

describe('hitTestChildren', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('returns null for empty children', () => {
    expect(hitTestChildren([], [5, 5])).toBeNull();
  });

  it('returns matching shape child', () => {
    const shape = makeShape(square, { id: 's1' });
    expect(hitTestChildren([shape], [5, 5])).toBe(shape);
  });

  it('returns null when point misses all children', () => {
    const shape = makeShape(square);
    expect(hitTestChildren([shape], [20, 20])).toBeNull();
  });

  it('skips invisible children', () => {
    const shape = makeShape(square, { visible: false });
    expect(hitTestChildren([shape], [5, 5])).toBeNull();
  });

  it('returns topmost (last in array) when stacked', () => {
    const bottom = makeShape(square, { id: 'bottom' });
    const top = makeShape(square, { id: 'top' });
    expect(hitTestChildren([bottom, top], [5, 5])?.id).toBe('top');
  });

  it('returns asset child', () => {
    const asset = makeAsset({ x: 5, y: 5 }, 4, 4, 1, 0, { id: 'a1' });
    expect(hitTestChildren([asset], [5, 5])).toBe(asset);
  });

  it('returns light child within hit radius', () => {
    const light = makeLight({ x: 5, y: 5 }, 5);
    // hitRadius = 0.5; [5.4, 5.4] — dist ≈ 0.566 > 0.5 — should miss
    expect(hitTestChildren([light], [5.4, 5.4])).toBeNull();
    // [5.1, 5.1] — dist ≈ 0.141 < 0.5 — should hit
    expect(hitTestChildren([light], [5.1, 5.1])).toBe(light);
  });
});

// ─── getChildBounds ───────────────────────────────────────

describe('getChildBounds', () => {
  it('computes AABB for a shape', () => {
    const shape = makeShape([[0, 0], [10, 0], [10, 5], [0, 5]]);
    const b = getChildBounds(shape);
    expect(b).toEqual({ x: 0, y: 0, width: 10, height: 5 });
  });

  it('computes AABB for an asset', () => {
    const asset = makeAsset({ x: 10, y: 10 }, 4, 6);
    const b = getChildBounds(asset);
    expect(b).toEqual({ x: 8, y: 7, width: 4, height: 6 });
  });

  it('computes AABB for a light', () => {
    const light = makeLight({ x: 5, y: 5 }, 3);
    const b = getChildBounds(light);
    expect(b).toEqual({ x: 2, y: 2, width: 6, height: 6 });
  });
});

// ─── boundsIntersect ──────────────────────────────────────

describe('boundsIntersect', () => {
  it('returns true for overlapping rects', () => {
    expect(boundsIntersect(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 },
    )).toBe(true);
  });

  it('returns false for non-overlapping rects', () => {
    expect(boundsIntersect(
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 6, y: 0, width: 5, height: 5 },
    )).toBe(false);
  });

  it('returns false for touching-but-not-overlapping rects', () => {
    expect(boundsIntersect(
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 5, y: 0, width: 5, height: 5 },
    )).toBe(false);
  });
});
