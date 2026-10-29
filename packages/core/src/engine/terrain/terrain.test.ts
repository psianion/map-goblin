import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerrainStrokeCommand, SNAPSHOT_BUDGET_BYTES } from './terrainCommands';
import {
  DISPLAY_FRAGMENT_SRC,
  setTerrainRenderer,
  type StrokeRegionSnapshot,
  type TerrainRenderer,
} from './TerrainRenderer';
import { useStore } from '../../store/store';
import { TERRAIN_BRUSH_RANGES, WATER_RANGES } from '../../store/slices/tools';
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

  it('drops the oldest snapshots once the retained pixel budget is exceeded', () => {
    const { fake, calls } = makeFakeRenderer();
    setTerrainRenderer(fake);
    // byteLength is all the budget accounting reads — no need to really allocate.
    const huge = (): StrokeRegionSnapshot => ({
      ...makeSnapshot(),
      before: { byteLength: SNAPSHOT_BUDGET_BYTES / 2 } as unknown as Uint8Array,
      after: { byteLength: SNAPSHOT_BUDGET_BYTES / 2 } as unknown as Uint8Array,
    });

    const first = new TerrainStrokeCommand([huge()]);
    const second = new TerrainStrokeCommand([huge()]);
    first.execute();
    second.execute();

    first.undo(); // evicted — its buffers are gone
    expect(calls.length).toBe(0);
    second.undo(); // newest stroke still undoable
    expect(calls.length).toBe(1);

    second.cleanup();
  });
});

describe('terrain display shader', () => {
  // The mesh pipe hands every mesh its alpha in uColor (and the render
  // group's in uWorldColorAlpha), but a custom shader has to apply it itself.
  // Without this the terrain opacity and a dungeon layer's opacity do nothing.
  it('scales the premultiplied bake sample by the mesh and world colour', () => {
    const src = DISPLAY_FRAGMENT_SRC.replace(/\s+/g, ' ');
    expect(src).toContain('uniform vec4 uColor;');
    expect(src).toContain('uniform vec4 uWorldColorAlpha;');
    expect(src).toContain('finalColor = texture(uBake, vUV) * uColor * uWorldColorAlpha;');
  });
});

describe('tool setting clamps', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('clamps to the same ranges the sliders expose', () => {
    const s = useStore.getState();
    s.updateTerrainBrushSettings({ radius: 999, strength: -1, tintOpacity: 2 });
    s.updateWaterSettings({ width: 999 });

    const { terrainBrush, water } = useStore.getState().tools.settings;
    expect(terrainBrush.radius).toBe(TERRAIN_BRUSH_RANGES.radius.max);
    expect(terrainBrush.strength).toBe(TERRAIN_BRUSH_RANGES.strength.min);
    expect(terrainBrush.tintOpacity).toBe(TERRAIN_BRUSH_RANGES.tintOpacity.max);
    expect(water.width).toBe(WATER_RANGES.width.max);
    expect(water).not.toHaveProperty('flowSpeed');
  });
});

describe('brush tint colour', () => {
  beforeEach(() => useStore.getState().resetToDefault());
  const brush = () => useStore.getState().tools.settings.terrainBrush;

  it('lifts a zero tint opacity to full when a colour is picked', () => {
    expect(brush().tintOpacity).toBe(0);
    useStore.getState().updateTerrainBrushSettings({ tintColor: '#f88b8b' });
    expect(brush().tintColor).toBe('#f88b8b');
    expect(brush().tintOpacity).toBe(1);
  });

  it('leaves an opacity the user already set alone', () => {
    const s = useStore.getState();
    s.updateTerrainBrushSettings({ tintOpacity: 0.4 });
    s.updateTerrainBrushSettings({ tintColor: '#3366ff' });
    expect(brush().tintOpacity).toBe(0.4);
  });

  it('keeps white untinted and honours an opacity sent with the colour', () => {
    const s = useStore.getState();
    s.updateTerrainBrushSettings({ tintColor: '#FFFFFF' });
    expect(brush().tintOpacity).toBe(0);
    s.updateTerrainBrushSettings({ tintColor: '#ff0000', tintOpacity: 0 });
    expect(brush().tintOpacity).toBe(0);
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
      tint: '#9fc8e8',
      opacity: 0.9,
      bankTextureId: 'bank-grassy-01-a1',
      bankWidth: 0.5,
      flowSpeed: 0.15,
      flowAngle: 0,
    };
  }

  it('water child round-trips through serialization, legacy flow fields included', () => {
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
    // Older maps carry flow fields; they load untouched even though nothing reads them.
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
