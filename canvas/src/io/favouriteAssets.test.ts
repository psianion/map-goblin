import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { FAVOURITE_ASSETS_KEY, initFavouriteAssets, loadFavouriteAssets } from './favouriteAssets';

const stars = () => useStore.getState().assets.favourites;

describe('favourite assets persistence', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.favourites = [];
    });
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('loads the saved stars into the store at boot', () => {
    localStorage.setItem(FAVOURITE_ASSETS_KEY, JSON.stringify(['a', 'b']));
    stop = initFavouriteAssets();
    expect(stars()).toEqual(['a', 'b']);
  });

  it('keeps stars given before boot in front of the saved ones', () => {
    localStorage.setItem(FAVOURITE_ASSETS_KEY, JSON.stringify(['a', 'b']));
    useStore.getState().toggleFavourite('c');
    stop = initFavouriteAssets();
    expect(stars()).toEqual(['c', 'a', 'b']);
  });

  it('writes every change back, an unstar included', () => {
    stop = initFavouriteAssets();
    useStore.getState().toggleFavourite('a');
    useStore.getState().toggleFavourite('b');
    expect(JSON.parse(localStorage.getItem(FAVOURITE_ASSETS_KEY) ?? 'null')).toEqual(expect.arrayContaining(['a', 'b']));
    useStore.getState().toggleFavourite('a');
    expect(JSON.parse(localStorage.getItem(FAVOURITE_ASSETS_KEY) ?? 'null')).toEqual(['b']);
  });

  it('stops writing once unsubscribed', () => {
    stop = initFavouriteAssets();
    stop();
    stop = null;
    useStore.getState().toggleFavourite('a');
    expect(localStorage.getItem(FAVOURITE_ASSETS_KEY)).toBeNull();
  });

  it('ignores a corrupt or foreign value', () => {
    localStorage.setItem(FAVOURITE_ASSETS_KEY, '{not json');
    expect(loadFavouriteAssets()).toEqual([]);
    localStorage.setItem(FAVOURITE_ASSETS_KEY, JSON.stringify({ a: 1 }));
    expect(loadFavouriteAssets()).toEqual([]);
    localStorage.setItem(FAVOURITE_ASSETS_KEY, JSON.stringify(['a', 3, '', 'a', 'b']));
    expect(loadFavouriteAssets()).toEqual(['a', 'b']);
  });
});
