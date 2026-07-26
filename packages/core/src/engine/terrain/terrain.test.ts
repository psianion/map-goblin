import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerrainStrokeCommand } from './terrainCommands';
import { setTerrainRenderer, type StrokeRegionSnapshot, type TerrainRenderer } from './TerrainRenderer';
import { useStore } from '../../store/store';
import type { WaterChild } from '../../shared/types';
import type { DungeonLayer } from '../../store/types';

function makeFakeRenderer() {
  const calls: { rtIndex: number; pixels: Uint8Array }[] = [];
  const fake = {
    restoreRegion: (rtIndex: 0 | 1, _rect: unknown, pixels: Uint8Array) => {
      calls.push({ rtIndex, pixels });
    },
  } as unknown as TerrainRenderer;
  return { fake, calls };
}

function makeSnapshot(): StrokeRegionSnapshot {
  return {
    rtIndex: 0,
    rect: { x: 0, y: 0, width: 2, height: 2 },
    before: new Uint8Array([1, 1, 1, 1]),
    after: new Uint8Array([9, 9, 9, 9]),
  };
}

describe('TerrainStrokeCommand', () => {
  afterEach(() => setTerrainRenderer(null));

  it('first execute is a no-op (stroke already painted), redo re-applies after', () => {
    const { fake, calls } = makeFakeRenderer();
    setTerrainRenderer(fake);
    const cmd = new TerrainStrokeCommand([makeSnapshot()]);

    cmd.execute(); // undoManager.execute() → live RT already has the stroke
    expect(calls.length).toBe(0);

    cmd.undo();
    expect(calls.length).toBe(1);
    expect(calls[0].pixels[0]).toBe(1); // before

    cmd.execute(); // redo
    expect(calls.length).toBe(2);
    expect(calls[1].pixels[0]).toBe(9); // after
  });

  it('cleanup() releases snapshots and later undo/redo are safe no-ops', () => {
    const { fake, calls } = makeFakeRenderer();
    setTerrainRenderer(fake);
    const cmd = new TerrainStrokeCommand([makeSnapshot()]);
    cmd.execute();
    cmd.cleanup();
    cmd.undo();
    cmd.execute();
    expect(calls.length).toBe(0);
  });
});

describe('water children in the store', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  function activeDungeonLayer(): DungeonLayer {
    const s = useStore.getState();
    return s.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  }

  function makeWater(): WaterChild {
    return {
      id: 'w1',
      name: 'River 1',
      childType: 'water',
      visible: true,
      waterType: 'river',
      contours: [[[0, 0], [4, 0], [4, 2], [0, 2]]],
      textureId: 'water-still-a-01',
      textureScale: 1,
      tint: '#9fc8e8',
      opacity: 0.9,
      bankTextureId: 'bank-grassy-01-a1',
      bankWidth: 0.5,
      flowSpeed: 0.15,
      flowAngle: 0,
    };
  }

  it('water child round-trips through serialization', () => {
    const layer = activeDungeonLayer();
    useStore.getState().addChild(layer.id, makeWater());

    const data = useStore.getState().getSerializableState();
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(structuredClone(data));

    const restored = useStore.getState().layers.find(
      (l): l is DungeonLayer => l.type === 'dungeon',
    )!;
    const water = restored.children.find((c) => c.childType === 'water') as WaterChild;
    expect(water).toBeDefined();
    expect(water.waterType).toBe('river');
    expect(water.contours[0].length).toBe(4);
    expect(water.flowSpeed).toBeCloseTo(0.15);
  });

  it('terrain data rides mapSettings through serialization', () => {
    useStore.getState().setTerrainData({ bounds: { minX: -3, minY: -2, maxX: 5, maxY: 4 } });
    const data = useStore.getState().getSerializableState();
    useStore.getState().resetToDefault();
    expect(useStore.getState().mapSettings.terrain).toBeUndefined();
    useStore.getState().loadFromFile(structuredClone(data));
    expect(useStore.getState().mapSettings.terrain?.bounds?.maxX).toBe(5);
    expect(useStore.getState().mapSettings.terrain?.palette.length).toBeGreaterThan(0);
  });
});
