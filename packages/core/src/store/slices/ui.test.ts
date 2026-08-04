import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { createDungeonLayer } from '../factories';
import type { DungeonLayer } from '../types';

function dungeonLayers(): DungeonLayer[] {
  return useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
}

describe('solo layer visibility (Alt-click eye)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('solos a layer: target visible, every other dungeon layer hidden, background untouched', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!;

    useStore.getState().toggleSoloLayer(layer1.id);

    const state = useStore.getState();
    expect(state.layers.find((l) => l.id === layer1.id)?.visible).toBe(true);
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(false);
    expect(state.layers.find((l) => l.id === bg.id)?.visible).toBe(true);
    expect(state.ui.solo).toEqual({
      layerId: layer1.id,
      prevVisibility: { [layer1.id]: true, [layer2.id]: true },
    });
  });

  it('toggling the same layer again restores the snapshot and clears solo', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    useStore.getState().updateLayer(layer2.id, { visible: false }); // pre-existing hidden layer
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id);
    useStore.getState().toggleSoloLayer(layer1.id);

    const state = useStore.getState();
    expect(state.layers.find((l) => l.id === layer1.id)?.visible).toBe(true);
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(false); // restored, not just "on"
    expect(state.ui.solo).toBeNull();
  });

  it('soloing a different layer while already soloed restores first, then solos the new target', () => {
    const layer2 = createDungeonLayer('Layer 2');
    const layer3 = createDungeonLayer('Layer 3');
    useStore.getState().addLayer(layer2);
    useStore.getState().addLayer(layer3);
    useStore.getState().updateLayer(layer3.id, { visible: false }); // authored hidden, pre-solo
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id); // solo layer1: layer2/layer3 forced hidden
    useStore.getState().toggleSoloLayer(layer2.id); // retarget to layer2

    const state = useStore.getState();
    // layer1 is no longer the target, so the new solo pass hides it too —
    // only layer2 (the new target) stays visible.
    expect(state.layers.find((l) => l.id === layer1.id)?.visible).toBe(false);
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(true); // newly soloed
    expect(state.layers.find((l) => l.id === layer3.id)?.visible).toBe(false); // was already hidden pre-solo
    expect(state.ui.solo).toEqual({
      layerId: layer2.id,
      // Snapshot taken from the just-restored state — layer1/layer3 read
      // their pre-solo authored values, not the mid-solo forced-hidden ones.
      prevVisibility: { [layer1.id]: true, [layer2.id]: true, [layer3.id]: false },
    });
  });

  it('removing the soloed layer restores the rest and clears solo', () => {
    // Guarded in layers.ts's removeLayer (not the ui slice) — it's the one
    // action that knows the layer is about to disappear, so stale solo
    // bookkeeping pointing at a removed id never sticks around.
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id); // layer2 forced hidden

    useStore.getState().removeLayer(layer1.id);

    const state = useStore.getState();
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(true);
    expect(state.ui.solo).toBeNull();
  });

  it('a manual visibility edit while soloed clears solo bookkeeping without reverting anything', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id); // layer2 forced hidden
    useStore.getState().clearSolo(); // what LayerRow's toggleVisibility calls before its own edit
    useStore.getState().updateLayer(layer2.id, { visible: true }); // the manual edit itself

    const state = useStore.getState();
    expect(state.ui.solo).toBeNull();
    // The manual edit's own effect stands — clearSolo does not revert it.
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(true);
    expect(state.layers.find((l) => l.id === layer1.id)?.visible).toBe(true);
  });

  it('toggleSoloLayer is a no-op for the background layer', () => {
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!;
    useStore.getState().toggleSoloLayer(bg.id);
    expect(useStore.getState().ui.solo).toBeNull();
  });

  it('solo state resets on resetToDefault (mirrors map-load reset)', () => {
    const [layer1] = dungeonLayers();
    useStore.getState().toggleSoloLayer(layer1.id);
    expect(useStore.getState().ui.solo).not.toBeNull();

    useStore.getState().resetToDefault();
    expect(useStore.getState().ui.solo).toBeNull();
  });
});
