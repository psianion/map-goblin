// src/io/snapPref.ts
// Snap on/off (grid.snapEnabled) kept across reloads in localStorage.
//
// Snap is how this DM likes to draw, not something the map says, so it is a per-browser
// view preference: the map file stores the grid's look and its snap division, never
// whether snapping is on. Opening a map keeps whatever is set here.

import { useStore } from '@/store/store';

export const SNAP_PREF_KEY = 'mapbuilder-snap-enabled';

/** The remembered setting, or null when there is none (the store's default stands). */
export function loadSnapPref(): boolean | null {
  try {
    const raw = localStorage.getItem(SNAP_PREF_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export function saveSnapPref(enabled: boolean): void {
  try {
    localStorage.setItem(SNAP_PREF_KEY, String(enabled));
  } catch {
    /* private mode or a full quota: the setting lasts the session */
  }
}

/**
 * Apply the remembered setting to the store, then write it back on every change.
 * Returns the unsubscribe.
 */
export function initSnapPref(store: typeof useStore = useStore): () => void {
  const saved = loadSnapPref();
  if (saved !== null && saved !== store.getState().grid.snapEnabled) {
    store.getState().setSnapEnabled(saved);
  }
  return store.subscribe((s, prev) => {
    if (s.grid.snapEnabled !== prev.grid.snapEnabled) saveSnapPref(s.grid.snapEnabled);
  });
}
