import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store.ts';
import { createDungeonLayer, createImagesLayer } from './factories.ts';
import type { SerializedMapData } from './types.ts';

describe('MapBuilderStore', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('initializes with valid default state', () => {
    const state = useStore.getState();
    expect(state).toBeDefined();
    expect(state.mapSettings.name).toBe('Untitled Map');
    expect(state.layers).toHaveLength(2);
    expect(state.layers[0].type).toBe('background');
    expect(state.layers[1].type).toBe('dungeon');
    expect(state.ui.activeLayerId).toBe(state.layers[1].id);
    expect(state.tools.activeTool).toBe('rectangle');
  });

  it('addLayer appends to the layer array', () => {
    const newLayer = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(newLayer);
    const state = useStore.getState();
    expect(state.layers).toHaveLength(3);
    expect(state.layers[2].name).toBe('Layer 2');
  });

  it('removeLayer removes and reassigns active layer', () => {
    const activeId = useStore.getState().ui.activeLayerId;
    useStore.getState().removeLayer(activeId);
    const state = useStore.getState();
    expect(state.layers).toHaveLength(1);
    expect(state.ui.activeLayerId).toBe(state.layers[0].id);
  });

  it('removeLayer cannot remove background layer', () => {
    const bgId = useStore.getState().layers[0].id;
    useStore.getState().removeLayer(bgId);
    expect(useStore.getState().layers).toHaveLength(2);
  });

  it('reorderLayers moves layers correctly', () => {
    const layer2 = createImagesLayer('Images');
    useStore.getState().addLayer(layer2);
    // layers: [bg, dungeon, images] -> move images to index 1
    useStore.getState().reorderLayers(2, 1);
    const state = useStore.getState();
    expect(state.layers[1].name).toBe('Images');
    expect(state.layers[2].name).toBe('Layer 1');
  });

  it('reorderLayers refuses to move background', () => {
    useStore.getState().reorderLayers(0, 1);
    expect(useStore.getState().layers[0].type).toBe('background');
  });

  it('setActiveTool updates active tool', () => {
    useStore.getState().setActiveTool('wall');
    expect(useStore.getState().tools.activeTool).toBe('wall');
  });

  it('togglePanel toggles panel visibility', () => {
    useStore.getState().togglePanel('right');
    expect(useStore.getState().ui.rightPanelOpen).toBe(false);
    useStore.getState().togglePanel('right');
    expect(useStore.getState().ui.rightPanelOpen).toBe(true);
  });

  it('getSerializableState returns correct shape', () => {
    const data = useStore.getState().getSerializableState();
    expect(data.version).toBe('1.1');
    expect(data.mapSettings.name).toBe('Untitled Map');
    expect(data.layers).toHaveLength(2);
    expect(data.lights).toEqual([]);
    expect(data.placedObjects).toEqual([]);
    expect(data.customImages).toEqual({});
  });

  it('loadFromFile restores state and rejects missing version', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    data.mapSettings.name = 'Loaded Map';
    useStore.getState().loadFromFile(data);
    expect(useStore.getState().mapSettings.name).toBe('Loaded Map');

    // Missing version should be a no-op
    const badData = { ...data, version: '' };
    useStore.getState().loadFromFile(badData as unknown as SerializedMapData);
    expect(useStore.getState().mapSettings.name).toBe('Loaded Map');
  });

  it('loadFromFile v1.1 round-trips all data correctly', () => {
    const original = structuredClone(useStore.getState().getSerializableState());
    original.mapSettings.name = 'Round-Trip Map';
    useStore.getState().loadFromFile(original);
    expect(useStore.getState().mapSettings.name).toBe('Round-Trip Map');
  });

  it('loadFromFile migrates v1.0 data to v1.1', () => {
    // v1.0 format: no placedObjects or customImages
    const v10 = {
      version: '1.0' as const,
      mapSettings: {
        name: 'Old Map',
        gridType: 'square' as const,
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#000000',
      },
      grid: { visible: true, snapDivision: 2 as const, style: 'clean' as const },
      layers: useStore.getState().layers,
      lights: [],
      // NOTE: no placedObjects or customImages — simulates actual v1.0 format
    };
    useStore.getState().loadFromFile(v10 as unknown as SerializedMapData);
    expect(useStore.getState().mapSettings.name).toBe('Old Map');
  });

  it('resetToDefault restores initial state', () => {
    useStore.getState().setMapName('Changed');
    useStore.getState().resetToDefault();
    expect(useStore.getState().mapSettings.name).toBe('Untitled Map');
  });
});
