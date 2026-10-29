// src/io/recentAssets.ts
// The recents list (assets.recentlyUsed) kept across reloads in localStorage.
//
// One list feeds the dock's asset strips and the browser's Recent tab, so a prop
// placed, a floor texture or a wall set picked yesterday is still a click away.

import { useStore } from '@/store/store';
import { RECENT_ASSET_LIMIT } from '@dnd/core/src/store/slices/assets';

export const RECENT_ASSETS_KEY = 'mapbuilder-recent-assets';

export function loadRecentAssets(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ASSETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)].slice(0, RECENT_ASSET_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentAssets(ids: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(ids));
  } catch {
    /* private mode or a full quota: the list lasts the session */
  }
}

/**
 * Load the saved list into the store, then write it back on every change. Anything
 * picked before boot finished stays in front of what was saved. Returns the unsubscribe.
 */
export function initRecentAssets(store: typeof useStore = useStore): () => void {
  const saved = loadRecentAssets();
  if (saved.length > 0) {
    store.setState((s) => {
      s.assets.recentlyUsed = [...new Set([...s.assets.recentlyUsed, ...saved])].slice(0, RECENT_ASSET_LIMIT);
    });
  }
  return store.subscribe((s, prev) => {
    if (s.assets.recentlyUsed !== prev.assets.recentlyUsed) saveRecentAssets(s.assets.recentlyUsed);
  });
}
