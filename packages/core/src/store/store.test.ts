import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { createDungeonLayer } from './factories';
import type { DoorChild } from '../shared/types';
import type { SerializedMapData } from './types';

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
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    // layers: [bg, dungeon, layer2] -> move layer2 to index 1
    useStore.getState().reorderLayers(2, 1);
    const state = useStore.getState();
    expect(state.layers[1].name).toBe('Layer 2');
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

  it('entering node edit clears the selection so the gizmo retires', () => {
    useStore.getState().setSelectedIds(['some-child']);
    useStore.getState().setShapeNodeEdit('shape-1');
    expect(useStore.getState().selection.selectedIds).toEqual([]);

    useStore.getState().setSelectedIds(['some-child']);
    useStore.getState().setNodeEditWall('wall-1');
    expect(useStore.getState().selection.selectedIds).toEqual([]);

    // Leaving the mode must not touch whatever was selected meanwhile.
    useStore.getState().setSelectedIds(['picked-inside']);
    useStore.getState().setShapeNodeEdit(null);
    useStore.getState().setNodeEditWall(null);
    expect(useStore.getState().selection.selectedIds).toEqual(['picked-inside']);
  });

  it('togglePanel toggles panel visibility', () => {
    useStore.getState().togglePanel('right');
    expect(useStore.getState().ui.rightPanelOpen).toBe(false);
    useStore.getState().togglePanel('right');
    expect(useStore.getState().ui.rightPanelOpen).toBe(true);
  });

  it('getSerializableState returns correct shape', () => {
    const data = useStore.getState().getSerializableState();
    expect(data.version).toBe('3.0');
    expect(data.mapSettings.name).toBe('Untitled Map');
    expect(data.layers).toHaveLength(2);
    expect(data.customImages).toEqual({});
  });

  it('loadFromFile restores state and rejects missing version', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    data.mapSettings.name = 'Loaded Map';
    useStore.getState().loadFromFile(data);
    expect(useStore.getState().mapSettings.name).toBe('Loaded Map');

    // Non-v2.0 version should be a no-op (rejected by migrateToLatest)
    const badData = { ...data, version: '1.0' };
    useStore.getState().loadFromFile(badData as unknown as SerializedMapData);
    // State should remain unchanged (still 'Loaded Map')
    expect(useStore.getState().mapSettings.name).toBe('Loaded Map');
  });

  it('loadFromFile splits inline splat data URLs into binary terrainSplats', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    // 1×1 transparent PNG
    const url =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    data.customImages = { [`__terrain-splat-0__`]: url, pic: 'data:image/png;base64,aGk=' };
    const revBefore = useStore.getState().terrainSplats.rev;
    useStore.getState().loadFromFile(data);
    const s = useStore.getState();
    // Splat left customImages, became a Blob; the ordinary picture stayed.
    expect(s.assets.customImages['__terrain-splat-0__']).toBeUndefined();
    expect(s.assets.customImages.pic).toBeDefined();
    expect(s.terrainSplats.pngs[0]).toBeInstanceOf(Blob);
    expect(s.terrainSplats.pngs[1]).toBeNull();
    expect(s.terrainSplats.rev).toBe(revBefore + 1);
  });

  it('loadFromFile prefers caller-provided binary splats over inline entries', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    data.customImages = { [`__terrain-splat-0__`]: 'data:image/png;base64,aGk=' };
    const provided: [Blob | null, Blob | null] = [null, new Blob(['x'], { type: 'image/png' })];
    useStore.getState().loadFromFile(data, provided);
    const s = useStore.getState();
    expect(s.terrainSplats.pngs[0]).toBeNull();
    expect(s.terrainSplats.pngs[1]).toBe(provided[1]);
    expect(s.assets.customImages['__terrain-splat-0__']).toBeUndefined();
  });

  it('loadFromFile v2.0 round-trips all data correctly', () => {
    const original = structuredClone(useStore.getState().getSerializableState());
    original.mapSettings.name = 'Round-Trip Map';
    useStore.getState().loadFromFile(original);
    expect(useStore.getState().mapSettings.name).toBe('Round-Trip Map');
  });

  it('keeps a door its authored name through a save/load round-trip', () => {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');
    const door: DoorChild = {
      id: 'door-1',
      // The whole point of the field: not "Single 1".
      name: 'Bone Door',
      childType: 'door',
      visible: true,
      wallId: '',
      position: [2, 2],
      angle: 0,
      width: 1,
      style: 'single',
      state: 'closed',
      isSecret: false,
    };
    useStore.getState().addChild(layer.id, door);

    const saved = structuredClone(useStore.getState().getSerializableState());
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(saved);

    const loaded = useStore.getState().layers.find((l) => l.type === 'dungeon');
    if (!loaded || loaded.type !== 'dungeon') throw new Error('Dungeon layer gone');
    expect(loaded.children.find((c) => c.id === 'door-1')?.name).toBe('Bone Door');
  });

  it('resetToDefault restores initial state', () => {
    useStore.getState().setMapName('Changed');
    useStore.getState().resetToDefault();
    expect(useStore.getState().mapSettings.name).toBe('Untitled Map');
  });
});
