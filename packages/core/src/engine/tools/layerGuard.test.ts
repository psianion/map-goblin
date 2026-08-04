import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../store/store';
import { createDungeonLayer } from '../../store/factories';
import { blockedLayerReason } from './layerGuard';

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
