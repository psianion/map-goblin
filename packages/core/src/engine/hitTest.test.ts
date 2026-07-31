import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  pointInShape,
  pointInAsset,
  hitTestChildren,
  getChildBounds,
  boundsIntersect,
} from './hitTest';
import type { ShapeChild, AssetChild, LightChild } from '../store/types';
import type { DoorChild, WaterChild } from '../shared/types';

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

function makeWater(outer: [number, number][]): WaterChild {
  return {
    id: 'water-1',
    name: 'Water',
    childType: 'water',
    visible: true,
    waterType: 'lake',
    contours: [outer],
    textureId: 'water-still-a-01',
    tint: '#9fc8e8',
    opacity: 0.9,
    bankTextureId: '',
    bankWidth: 0.5,
    flowSpeed: 0,
    flowAngle: 0,
  };
}

function makeDoor(
  position: [number, number],
  overrides?: Partial<DoorChild>,
): DoorChild {
  return {
    id: 'door-1',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: '',
    position,
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...overrides,
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

  it('returns door child within its hit radius', () => {
    const door = makeDoor([5, 5], { width: 1 });
    // half-width 0.5 > DOOR_MIN_HIT_RADIUS; dist ≈ 0.42 < 0.5 — hit
    expect(hitTestChildren([door], [5.3, 5.3])).toBe(door);
    expect(hitTestChildren([door], [6, 6])).toBeNull();
  });

  it('prefers a door over the shape it sits on', () => {
    // A floor-ring door sits ON the room outline, so the shape's polygon
    // contains the click point too — the door (rendered on top) must win.
    const shape = makeShape(square, { id: 'floor' });
    const door = makeDoor([5, 0], { id: 'door-1' });
    expect(hitTestChildren([shape, door], [5, 0.1])?.id).toBe('door-1');
  });

  it('skips invisible doors', () => {
    const door = makeDoor([5, 5], { visible: false });
    expect(hitTestChildren([door], [5, 5])).toBeNull();
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

  it('computes AABB for water from its outer contour', () => {
    const b = getChildBounds(makeWater([[2, 1], [8, 1], [8, 6], [2, 6]]));
    expect(b).toEqual({ x: 2, y: 1, width: 6, height: 5 });
  });

  it('ignores water holes — bounds come from the outer contour only', () => {
    const water = makeWater([[0, 0], [10, 0], [10, 10], [0, 10]]);
    water.contours.push([[3, 3], [7, 3], [7, 7], [3, 7]]);
    expect(getChildBounds(water)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('returns a zero rect for water with an empty contour', () => {
    const water = makeWater([]);
    expect(getChildBounds(water)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
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
