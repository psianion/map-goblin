// src/io/favouriteAssets.ts
// The DM's starred props (assets.favourites) kept across reloads in localStorage.
//
// Per browser, exactly like the recents list: the props browser's Favourites view and
// the front of the dock's Props strip read the same list.

import { useStore } from '@/store/store';

export const FAVOURITE_ASSETS_KEY = 'mapbuilder-favourite-assets';

export function loadFavouriteAssets(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITE_ASSETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export function saveFavouriteAssets(ids: readonly string[]): void {
  try {
    localStorage.setItem(FAVOURITE_ASSETS_KEY, JSON.stringify(ids));
  } catch {
    /* private mode or a full quota: the stars last the session */
  }
}

/**
 * Load the saved stars into the store, then write them back on every change. A star
 * given before boot finished stays in front of what was saved. Returns the unsubscribe.
 */
export function initFavouriteAssets(store: typeof useStore = useStore): () => void {
  const saved = loadFavouriteAssets();
  if (saved.length > 0) {
    store.setState((s) => {
      s.assets.favourites = [...new Set([...s.assets.favourites, ...saved])];
    });
  }
  return store.subscribe((s, prev) => {
    if (s.assets.favourites !== prev.assets.favourites) saveFavouriteAssets(s.assets.favourites);
  });
}
