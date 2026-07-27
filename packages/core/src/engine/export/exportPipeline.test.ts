import { describe, it, expect, beforeEach } from 'vitest';
import { computeMapWorldBounds } from './exportPipeline';
import { useStore } from '../../store/store';
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function makeWater(outer: [number, number][], visible = true): WaterChild {
  return {
    id: `water-${outer[0]?.join('_') ?? 'empty'}`,
    name: 'Water',
    childType: 'water',
    visible,
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

/** A dungeon layer carrying the given floor polygon and water children. */
function layerWith(
  mergedFloor: [number, number][][] | null,
  children: WaterChild[] = [],
): DungeonLayer {
  return { ...dungeonLayer(), mergedFloor, children };
}

beforeEach(() => useStore.getState().resetToDefault());

describe('computeMapWorldBounds', () => {
  it('takes terrain bounds as an argument instead of only reading the live store', () => {
    const b = computeMapWorldBounds([layerWith(null)], { minX: -30, minY: -20, maxX: 30, maxY: 20 });
    expect(b.minX).toBeLessThanOrEqual(-30);
    expect(b.maxX).toBeGreaterThanOrEqual(30);
    // Explicitly passing null opts out of the store read entirely
    expect(computeMapWorldBounds([layerWith(null)], null)).toEqual({
      minX: -5, minY: -5, maxX: 5, maxY: 5,
    });
  });

  it('falls back to a 10x10 grid when there is no geometry at all', () => {
    expect(computeMapWorldBounds([layerWith(null)])).toEqual({
      minX: -5, minY: -5, maxX: 5, maxY: 5,
    });
  });

  it('covers a water-only layer that has no floor geometry', () => {
    // Regression: bounds used to skip any layer without mergedFloor, so a map
    // made purely of water exported as the empty 10x10 default.
    const b = computeMapWorldBounds([layerWith(null, [makeWater([[0, 0], [20, 0], [20, 12], [0, 12]])])]);
    expect(b.maxX).toBeGreaterThanOrEqual(20);
    expect(b.maxY).toBeGreaterThanOrEqual(12);
    expect(b.minX).toBeLessThanOrEqual(0);
  });

  it('extends floor bounds to take in water that spills past them', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const withoutWater = computeMapWorldBounds([layerWith(floor)]);
    const withWater = computeMapWorldBounds([
      layerWith(floor, [makeWater([[10, 0], [30, 0], [30, 10], [10, 10]])]),
    ]);

    expect(withWater.maxX).toBeGreaterThan(withoutWater.maxX);
    expect(withWater.maxX).toBeGreaterThanOrEqual(30);
    expect(withWater.minX).toBe(withoutWater.minX);
  });

  it('ignores hidden water bodies', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const baseline = computeMapWorldBounds([layerWith(floor)]);
    const hidden = computeMapWorldBounds([
      layerWith(floor, [makeWater([[10, 0], [30, 0], [30, 10], [10, 10]], false)]),
    ]);

    expect(hidden).toEqual(baseline);
  });

  it('extends bounds to cover painted terrain', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const baseline = computeMapWorldBounds([layerWith(floor)]);

    useStore.getState().setTerrainData({ bounds: { minX: -20, minY: -8, maxX: 12, maxY: 10 } });
    const withTerrain = computeMapWorldBounds([layerWith(floor)]);

    expect(withTerrain.minX).toBeLessThanOrEqual(-20);
    expect(withTerrain.minY).toBeLessThanOrEqual(-8);
    expect(withTerrain.minX).toBeLessThan(baseline.minX);
  });

  it('covers a terrain-only map with no floor and no water', () => {
    useStore.getState().setTerrainData({ bounds: { minX: -3, minY: -3, maxX: 40, maxY: 25 } });
    const b = computeMapWorldBounds([layerWith(null)]);

    expect(b.maxX).toBeGreaterThanOrEqual(40);
    expect(b.maxY).toBeGreaterThanOrEqual(25);
  });
});
