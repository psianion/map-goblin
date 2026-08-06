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
    expect(data.version).toBe('3.1');
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

// ─── prep (schema 3.1) ──────────────────────────────────────

describe('getSerializableState / loadFromFile — prep', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('writes version 3.1', () => {
    expect(useStore.getState().getSerializableState().version).toBe('3.1');
  });

  it('omits the prep key entirely when nothing was ever authored', () => {
    const data = useStore.getState().getSerializableState();
    expect(data.prep).toBeUndefined();
    // The field is `undefined`, not absent from the object literal — `in` would
    // still say true. JSON.stringify is what a save file actually goes through,
    // and that is what drops the key so an unauthored prep leaves the server's
    // stored prep alone on republish.
    expect(JSON.stringify(data)).not.toContain('"prep"');
  });

  it('carries authored triggers', () => {
    useStore.getState().upsertTrigger({
      id: 't1',
      name: 'Trap',
      when: { kind: 'enter-region', zoneId: 'z1' },
      actions: [],
      once: true,
      enabled: true,
    });
    const data = useStore.getState().getSerializableState();
    expect(data.prep).toEqual({ version: 1, triggers: [expect.objectContaining({ id: 't1' })] });
  });

  it('an explicit empty-triggers prep survives (explicit clear, not absence)', () => {
    useStore.getState().upsertTrigger({
      id: 't1',
      name: 'Trap',
      when: { kind: 'enter-region', zoneId: 'z1' },
      actions: [],
      once: true,
      enabled: true,
    });
    useStore.getState().removeTrigger('t1');
    const data = useStore.getState().getSerializableState();
    expect(data.prep).toEqual({ version: 1, triggers: [] });
  });

  it('accepts a 3.1 doc with prep and a zone child, and sets store prep', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    const layer = data.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
    layer.children.push({
      id: 'zone-1',
      name: 'Zone',
      childType: 'zone',
      visible: true,
      shape: { kind: 'point', position: { x: 1, y: 1 } },
    });
    data.version = '3.1';
    data.prep = { version: 1, triggers: [{ id: 't1', name: 'Trap', when: { kind: 'enter-region', zoneId: 'zone-1' }, actions: [], once: true, enabled: true }] };

    useStore.getState().loadFromFile(data);

    expect(useStore.getState().prep).toEqual(data.prep);
    const loadedLayer = useStore.getState().layers.find((l) => l.type === 'dungeon');
    if (!loadedLayer || loadedLayer.type !== 'dungeon') throw new Error('Dungeon layer gone');
    expect(loadedLayer.children.some((c) => c.id === 'zone-1')).toBe(true);
  });

  it('rejects an unsupported version and leaves prep untouched', () => {
    useStore.getState().upsertTrigger({
      id: 'keep-me',
      name: 'Trap',
      when: { kind: 'enter-region', zoneId: 'z1' },
      actions: [],
      once: true,
      enabled: true,
    });
    const before = useStore.getState().prep;
    const data = structuredClone(useStore.getState().getSerializableState());
    useStore.getState().loadFromFile({ ...data, version: '4.0' } as unknown as SerializedMapData);
    expect(useStore.getState().prep).toEqual(before);
  });

  it('a 3.0 doc with no prep field loads with store prep null', () => {
    const data = structuredClone(useStore.getState().getSerializableState());
    delete (data as { prep?: unknown }).prep;
    data.version = '3.0';
    useStore.getState().loadFromFile(data);
    expect(useStore.getState().prep).toBeNull();
  });
});
