import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../store/store';
import { createDungeonLayer, createImageLayer } from '../../store/factories';
import { setNotify, type NotifyFn } from '../../store/notify';
import { TERRAIN_PANEL_ID } from '../../store/types';
import { TRACE_LAYER_MESSAGE, blockedLayerReason, noEditableLayerMessage, resolveEditableLayer } from './layerGuard';

describe('blockedLayerReason', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('null for a layer that is unlocked, visible, and not solo-hidden', () => {
    expect(blockedLayerReason(createDungeonLayer('L'))).toBeNull();
  });

  it('locked beats everything else', () => {
    const layer = createDungeonLayer('L');
    layer.locked = true;
    expect(blockedLayerReason(layer)).toBe('Layer is locked');
  });

  it('reports hidden for an authored-hidden layer', () => {
    const layer = createDungeonLayer('L');
    layer.visible = false;
    expect(blockedLayerReason(layer)).toBe('Layer is hidden');
  });

  // F1 (HIGH-1/2): solo is a render-only override — it never writes
  // `layer.visible` — so this has to read solo off the store itself
  // (isLayerEffectivelyVisible) rather than trusting the layer's own flag,
  // or every write path that shares this gate (tools, ChildRow duplicate/
  // delete, wall node editing) would let you edit into a solo-hidden layer.
  it('reports hidden for a layer that is only hidden because another layer is soloed', () => {
    const layer = createDungeonLayer('L');
    expect(layer.visible).toBe(true);

    useStore.setState((s) => {
      s.ui.solo = { layerId: 'some-other-layer-id' };
    });

    expect(blockedLayerReason(layer)).toBe('Layer is hidden');
  });

  it('the soloed layer itself is not blocked', () => {
    const layer = createDungeonLayer('L');
    useStore.setState((s) => {
      s.ui.solo = { layerId: layer.id };
    });
    expect(blockedLayerReason(layer)).toBeNull();
  });
});

// D5(a): "Select a layer first" reads as a bug when the Terrain row is
// visibly selected in the panel.
describe('noEditableLayerMessage', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('is the plain message when no layer (or a non-terrain sentinel) is active', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    expect(noEditableLayerMessage()).toBe('Select a layer first');
  });

  it('is terrain-aware when the Terrain row is active', () => {
    useStore.getState().setActiveLayerId(TERRAIN_PANEL_ID);
    expect(noEditableLayerMessage()).toBe('Terrain is selected — pick a layer to draw on');
  });
});

describe('a trace layer in hand', () => {
  const warned: string[] = [];
  beforeEach(() => {
    useStore.getState().resetToDefault();
    warned.length = 0;
    setNotify({ info: () => {}, success: () => {}, error: () => {}, warning: (m: string) => void warned.push(m) } as unknown as NotifyFn);
    useStore.getState().addCustomImage('sketch', 'data:image/png;base64,AAAA');
    const trace = createImageLayer(useStore.getState().levels[0].id, 'sketch', 'sketch.png');
    useStore.getState().addLayer(trace);
    useStore.getState().setActiveLayerId(trace.id);
  });

  it('refuses a drawing tool with the trace message, not "Layer was removed"', () => {
    const before = JSON.stringify(useStore.getState().layers);
    expect(resolveEditableLayer(useStore.getState().ui.activeLayerId)).toBeNull();
    expect(warned).toEqual([TRACE_LAYER_MESSAGE]);
    expect(TRACE_LAYER_MESSAGE).toBe('Trace layer · pick a dungeon layer to draw');
    expect(JSON.stringify(useStore.getState().layers)).toBe(before);
  });

  it('says the same where a tool finds no layer to draw on', () => {
    expect(noEditableLayerMessage()).toBe(TRACE_LAYER_MESSAGE);
  });

  it('still says the layer was removed for one that is gone', () => {
    expect(resolveEditableLayer('gone')).toBeNull();
    expect(warned).toEqual(['Layer was removed']);
  });
});
