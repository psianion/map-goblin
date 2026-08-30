import { describe, it, expect, beforeEach } from 'vitest';
import { assetBounds, computeContentBounds, computeMapFrame } from './mapBounds';
import { useStore } from '../store/store';
import type { AssetChild, DungeonLayer, Layer, WallSegment } from '../store/types';

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function layerWith(mergedFloor: [number, number][][] | null): DungeonLayer {
  return { ...dungeonLayer(), mergedFloor, children: [], standaloneWalls: [] };
}

function makeWall(points: [number, number][], width = 0.4): WallSegment {
  return {
    id: `wall-${points[0]?.join('_')}`,
    points,
    wallType: 'normal',
    direction: 'both',
    color: '#888888',
    width,
    roughness: 0,
  };
}

function makeAsset(x: number, y: number, visible = true): AssetChild {
  return {
    id: `asset-${x}_${y}`,
    name: 'Barrel',
    childType: 'asset',
    visible,
    objectType: 'asset',
    assetId: 'barrel',
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 2,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

beforeEach(() => useStore.getState().resetToDefault());

describe('computeContentBounds', () => {
  it('is null on a map with nothing drawn — no 10x10 export default here', () => {
    expect(computeContentBounds([layerWith(null)], null)).toBeNull();
  });

  it('survives a document with sparse layers (no children, no style)', () => {
    const bare = {
      ...layerWith([[[0, 0], [4, 0], [4, 3], [0, 3]]]),
      children: undefined,
      style: undefined,
    } as unknown as Layer;
    const b = computeContentBounds([bare], null);
    expect(b).not.toBeNull();
    expect(Number.isFinite(b!.minX)).toBe(true);
    expect(Number.isFinite(b!.maxY)).toBe(true);
  });

  it('measures a wall-only map — a wall drawn on empty ground is still map', () => {
    const layer = { ...layerWith(null), standaloneWalls: [makeWall([[3, 4], [9, 4]])] };
    const b = computeContentBounds([layer], null);
    expect(b!.minX).toBeLessThanOrEqual(3);
    expect(b!.maxX).toBeGreaterThanOrEqual(9);
    expect(b!.minY).toBeLessThanOrEqual(4);
  });

  it('grows for a standalone wall wider than its layer style', () => {
    const thin = computeContentBounds(
      [{ ...layerWith(null), standaloneWalls: [makeWall([[0, 0], [4, 0]], 0.2)] }],
      null,
    );
    const fat = computeContentBounds(
      [{ ...layerWith(null), standaloneWalls: [makeWall([[0, 0], [4, 0]], 3)] }],
      null,
    );
    expect(fat!.maxX).toBeGreaterThan(thin!.maxX);
  });

  it('measures an asset-only map — placing art grows the boundary', () => {
    const layer = { ...layerWith(null), children: [makeAsset(10, 10)] };
    const b = computeContentBounds([layer], null);
    // The 2x2 sprite reaches one cell each way, plus the stroke/shadow padding
    // computeContentBounds adds on top of raw content.
    expect(b!.minX).toBeLessThanOrEqual(9);
    expect(b!.maxY).toBeGreaterThanOrEqual(11);
  });

  it('measures a sprite as its own rectangle, not a circle of its diagonal', () => {
    // A battlemap is the case that made this matter: taking half the diagonal measured a
    // 16x22.55 image as 27x27, and that slack became export pixels and fog cells.
    const battlemap = { ...makeAsset(0, 0), width: 16, height: 22.55 };
    expect(assetBounds([{ ...layerWith(null), children: [battlemap] }])).toEqual({
      minX: -8,
      minY: -11.275,
      maxX: 8,
      maxY: 11.275,
    });
  });

  it('still contains a rotated sprite', () => {
    const spun = { ...makeAsset(0, 0), rotation: Math.PI / 4 };
    const b = assetBounds([{ ...layerWith(null), children: [spun] }])!;
    // A 2x2 turned 45° genuinely does reach half its diagonal on both axes.
    expect(b.maxX).toBeCloseTo(Math.SQRT2, 6);
    expect(b.maxY).toBeCloseTo(Math.SQRT2, 6);
  });

  it('ignores hidden assets', () => {
    const floor: [number, number][][] = [[[0, 0], [4, 0], [4, 4], [0, 4]]];
    const baseline = computeContentBounds([layerWith(floor)], null);
    const hidden = computeContentBounds(
      [{ ...layerWith(floor), children: [makeAsset(40, 40, false)] }],
      null,
    );
    expect(hidden).toEqual(baseline);
  });
});

describe('computeMapFrame', () => {
  it('is null while nothing is drawn — an empty map is all void, no frame', () => {
    expect(computeMapFrame([layerWith(null)], null)).toBeNull();
  });

  it('snaps content bounds out to the enclosing whole cells, plus a cell all round', () => {
    const frame = computeMapFrame([layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])], null);
    // Content bounds carry sub-cell padding (wall stroke + shadow + AA, 0.7 with the
    // default style): floor(2 - 0.7) = 1, then one more cell of clear air = 0.
    expect(frame).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
  });

  it('leaves a full cell of clear ground past the outermost geometry', () => {
    const frame = computeMapFrame([layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])], null);
    expect(2 - frame!.minX).toBeGreaterThanOrEqual(1);
    expect(2 - frame!.minY).toBeGreaterThanOrEqual(1);
    expect(frame!.maxX - 7).toBeGreaterThanOrEqual(1);
    expect(frame!.maxY - 5).toBeGreaterThanOrEqual(1);
  });

  it('takes a fixed size over the measured one, anchored at the origin', () => {
    const layers = [layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])];
    expect(computeMapFrame(layers, null, { width: 30, height: 20 })).toEqual({
      minX: 0, minY: 0, maxX: 30, maxY: 20,
    });
    // Content outside a fixed frame is allowed — it just falls outside the map
    expect(computeMapFrame(layers, null, { width: 3, height: 3 })).toEqual({
      minX: 0, minY: 0, maxX: 3, maxY: 3,
    });
    // A fixed map has a frame even with nothing drawn on it
    expect(computeMapFrame([layerWith(null)], null, { width: 8, height: 8 })).toEqual({
      minX: 0, minY: 0, maxX: 8, maxY: 8,
    });
  });

  it('measures floor shape children when mergedFloor is null — the server case', () => {
    // Saved files ship mergedFloor null (derived cache); the session server measures
    // frames off exactly such documents at redaction time.
    const shape = {
      id: 's1',
      name: 'Rectangle 1',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[2, 2], [7, 2], [7, 5], [2, 5]]],
    };
    const layer = { ...layerWith(null), children: [shape] } as unknown as Layer;
    expect(computeMapFrame([layer], null)).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
  });

  it('includes painted terrain in the frame', () => {
    const frame = computeMapFrame(
      [layerWith([[[0, 0], [2, 0], [2, 2], [0, 2]]])],
      { minX: -10, minY: -6, maxX: 3, maxY: 3 },
    );
    expect(frame!.minX).toBeLessThanOrEqual(-11);
    expect(frame!.minY).toBeLessThanOrEqual(-7);
  });
});
