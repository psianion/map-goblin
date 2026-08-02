import { describe, it, expect, beforeEach } from 'vitest';
import { computeContentBounds, computeMapFrame } from './mapBounds';
import { useStore } from '../store/store';
import type { DungeonLayer, Layer } from '../store/types';

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function layerWith(mergedFloor: [number, number][][] | null): DungeonLayer {
  return { ...dungeonLayer(), mergedFloor, children: [] };
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
});

describe('computeMapFrame', () => {
  it('is null while nothing is drawn — an empty map is all void, no frame', () => {
    expect(computeMapFrame([layerWith(null)], null)).toBeNull();
  });

  it('snaps content bounds out to the enclosing whole cells', () => {
    const frame = computeMapFrame([layerWith([[[2, 2], [7, 2], [7, 5], [2, 5]]])], null);
    // Content bounds carry sub-cell padding (wall stroke + shadow + AA, 0.7 with the
    // default style), so the frame is the enclosing integer box: floor(2 - 0.7) = 1.
    expect(frame).toEqual({ minX: 1, minY: 1, maxX: 8, maxY: 6 });
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
    expect(computeMapFrame([layer], null)).toEqual({ minX: 1, minY: 1, maxX: 8, maxY: 6 });
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
