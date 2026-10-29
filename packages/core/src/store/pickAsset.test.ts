import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { pickAsset } from './pickAsset';

const brush = () => useStore.getState().tools.settings.scatterBrush;

describe('pickAsset', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
    });
  });

  it('stamps the one prop and takes up the brush from another tool', () => {
    useStore.getState().setActiveTool('select');
    useStore.getState().updateScatterBrushSettings({ assetIds: ['a', 'b'], stampMode: false });

    pickAsset(useStore.getState(), 'c');

    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
    expect(brush().assetIds).toEqual(['c']);
    expect(brush().stampMode).toBe(true);
  });

  it('a new stamp pick starts square to the grid again', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ assetIds: ['a'], stampMode: true, stampRotation: Math.PI / 6 });

    pickAsset(useStore.getState(), 'b');

    expect(brush().stampRotation).toBe(0);
  });

  it('a scatter pool pick leaves the stamp angle alone', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ assetIds: ['a'], stampMode: false, stampRotation: Math.PI / 6 });

    pickAsset(useStore.getState(), 'b');

    expect(brush().stampRotation).toBeCloseTo(Math.PI / 6);
  });

  it('replaces the stamp when the brush is already stamping', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ assetIds: ['a'], stampMode: true });

    pickAsset(useStore.getState(), 'b');

    expect(brush().assetIds).toEqual(['b']);
    expect(brush().stampMode).toBe(true);
  });

  it('toggles the prop in and out of the pool in scatter mode', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ assetIds: ['a'], stampMode: false });

    pickAsset(useStore.getState(), 'b');
    expect(brush().assetIds).toEqual(['a', 'b']);
    expect(brush().stampMode).toBe(false);

    pickAsset(useStore.getState(), 'a');
    expect(brush().assetIds).toEqual(['b']);
  });

  it('puts every pick at the front of the recents', () => {
    pickAsset(useStore.getState(), 'a');
    pickAsset(useStore.getState(), 'b');
    pickAsset(useStore.getState(), 'a');
    expect(useStore.getState().assets.recentlyUsed).toEqual(['a', 'b']);
  });
});
