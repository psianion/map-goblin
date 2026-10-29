import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { RECENT_ASSET_LIMIT } from '@dnd/core/src/store/slices/assets';
import { initRecentAssets, loadRecentAssets, RECENT_ASSETS_KEY } from './recentAssets';

const recent = () => useStore.getState().assets.recentlyUsed;

describe('recent assets persistence', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
    });
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('loads the saved list into the store at boot', () => {
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(['a', 'b']));
    stop = initRecentAssets();
    expect(recent()).toEqual(['a', 'b']);
  });

  it('keeps picks made before boot in front of the saved list', () => {
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(['a', 'b']));
    useStore.getState().trackRecentUse('b');
    stop = initRecentAssets();
    expect(recent()).toEqual(['b', 'a']);
  });

  it('writes every change back', () => {
    stop = initRecentAssets();
    useStore.getState().trackRecentUse('a');
    useStore.getState().trackRecentUse('b');
    expect(JSON.parse(localStorage.getItem(RECENT_ASSETS_KEY) ?? 'null')).toEqual(['b', 'a']);
  });

  it('stops writing once unsubscribed', () => {
    stop = initRecentAssets();
    stop();
    stop = null;
    useStore.getState().trackRecentUse('a');
    expect(localStorage.getItem(RECENT_ASSETS_KEY)).toBeNull();
  });

  it('ignores a corrupt or foreign value', () => {
    localStorage.setItem(RECENT_ASSETS_KEY, '{not json');
    expect(loadRecentAssets()).toEqual([]);
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify({ a: 1 }));
    expect(loadRecentAssets()).toEqual([]);
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(['a', 3, '', 'a', 'b']));
    expect(loadRecentAssets()).toEqual(['a', 'b']);
  });

  it(`caps a long saved list at ${RECENT_ASSET_LIMIT}`, () => {
    const ids = Array.from({ length: RECENT_ASSET_LIMIT + 6 }, (_, i) => `id-${i}`);
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(ids));
    expect(loadRecentAssets()).toEqual(ids.slice(0, RECENT_ASSET_LIMIT));
  });
});
