import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { createDungeonLayer } from '../factories';
import { isLayerEffectivelyVisible } from '../selectors';
import { PropertyCommand } from '../commands';
import { undoManager } from '../undoManager';
import type { DungeonLayer } from '../types';

function dungeonLayers(): DungeonLayer[] {
  return useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
}

// F1 (HIGH-1 + HIGH-2): solo used to write `visible: false` into every
// non-soloed dungeon layer, which meant autosave persisted the hidden flags
// (a solo → autosave → reload sequence left layers permanently hidden) and
// un-soloing replayed a snapshot that silently reverted any undo/redo done
// while soloed. Solo is now a render-only pointer — `ui.solo: { layerId } |
// null` — and never touches a layer's own `visible`. Every consumer that
// cares whether a layer is showing goes through `isLayerEffectivelyVisible`
// instead (see hitTest.test.ts, layerGuard.test.ts, subscribeToStore.test.ts
// for the render/interaction side of this).
describe('solo layer visibility (Alt-click eye) — render-only override', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('toggleSoloLayer never writes any layer.visible', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();
    const before = useStore.getState().layers.map((l) => ({ id: l.id, visible: l.visible }));

    useStore.getState().toggleSoloLayer(layer1.id);

    const after = useStore.getState().layers.map((l) => ({ id: l.id, visible: l.visible }));
    expect(after).toEqual(before);
    expect(useStore.getState().ui.solo).toEqual({ layerId: layer1.id });
  });

  it('does not dirty serialization — getSerializableState is byte-identical before/during/after solo', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    const before = JSON.stringify(useStore.getState().getSerializableState());
    useStore.getState().toggleSoloLayer(layer1.id);
    const during = JSON.stringify(useStore.getState().getSerializableState());
    useStore.getState().toggleSoloLayer(layer1.id);
    const after = JSON.stringify(useStore.getState().getSerializableState());

    expect(during).toBe(before);
    expect(after).toBe(before);
  });

  it('effective visibility: target visible, every other dungeon layer effectively hidden, background untouched', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!;

    useStore.getState().toggleSoloLayer(layer1.id);

    const state = useStore.getState();
    expect(isLayerEffectivelyVisible(state, state.layers.find((l) => l.id === layer1.id)!)).toBe(true);
    expect(isLayerEffectivelyVisible(state, state.layers.find((l) => l.id === layer2.id)!)).toBe(false);
    expect(isLayerEffectivelyVisible(state, bg)).toBe(true);
  });

  it('toggling the same layer again clears solo', () => {
    const [layer1] = dungeonLayers();
    useStore.getState().toggleSoloLayer(layer1.id);
    useStore.getState().toggleSoloLayer(layer1.id);
    expect(useStore.getState().ui.solo).toBeNull();
  });

  it('soloing a different layer retargets without ever writing visible', () => {
    const layer2 = createDungeonLayer('Layer 2');
    const layer3 = createDungeonLayer('Layer 3');
    useStore.getState().addLayer(layer2);
    useStore.getState().addLayer(layer3);
    useStore.getState().updateLayer(layer3.id, { visible: false }); // authored hidden
    const [layer1] = dungeonLayers();
    const before = useStore.getState().layers.map((l) => ({ id: l.id, visible: l.visible }));

    useStore.getState().toggleSoloLayer(layer1.id);
    useStore.getState().toggleSoloLayer(layer2.id); // retarget

    expect(useStore.getState().ui.solo).toEqual({ layerId: layer2.id });
    // Authored flags never moved, including layer3's pre-existing hidden state.
    expect(useStore.getState().layers.map((l) => ({ id: l.id, visible: l.visible }))).toEqual(before);
  });

  it('undo of a visibility command done while soloed applies cleanly and survives un-solo', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id); // layer2 effectively hidden, layer2.visible still true
    undoManager.execute(new PropertyCommand(
      'Hide layer',
      { type: 'layer', layerId: layer2.id },
      { visible: true },
      { visible: false },
    ));
    expect(useStore.getState().layers.find((l) => l.id === layer2.id)?.visible).toBe(false);

    undoManager.undo();
    expect(useStore.getState().layers.find((l) => l.id === layer2.id)?.visible).toBe(true);

    // Old design replayed a `prevVisibility` snapshot on un-solo, which
    // silently clobbered whatever undo/redo had just done. Nothing to replay
    // now — un-soloing must leave the undo's result exactly as it was.
    useStore.getState().toggleSoloLayer(layer1.id);
    expect(useStore.getState().layers.find((l) => l.id === layer2.id)?.visible).toBe(true);
  });

  it('removing the soloed layer clears solo (nothing to restore)', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id);
    useStore.getState().removeLayer(layer1.id);

    const state = useStore.getState();
    expect(state.ui.solo).toBeNull();
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(true);
  });

  it('a manual visibility edit while soloed clears solo bookkeeping without reverting anything', () => {
    const layer2 = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(layer2);
    const [layer1] = dungeonLayers();

    useStore.getState().toggleSoloLayer(layer1.id);
    useStore.getState().clearSolo(); // what LayerRow's toggleVisibility calls before its own edit
    useStore.getState().updateLayer(layer2.id, { visible: false });

    const state = useStore.getState();
    expect(state.ui.solo).toBeNull();
    expect(state.layers.find((l) => l.id === layer2.id)?.visible).toBe(false);
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
