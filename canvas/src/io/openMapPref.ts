// src/io/openMapPref.ts
// Which map was open, kept across reloads in localStorage.
//
// Without it the boot opens the most recently saved map, so the open map only survives a
// reload if its last save lands first: going home saves without waiting, and a reload
// straight after (or a slow save behind other work) brought the previous map back instead.

import { useStore } from '@/store/store';

export const OPEN_MAP_KEY = 'mapbuilder-open-map';

export function rememberedOpenMap(): string | null {
  try {
    return localStorage.getItem(OPEN_MAP_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(OPEN_MAP_KEY, id);
    else localStorage.removeItem(OPEN_MAP_KEY);
  } catch {
    /* private mode or a full quota: the most recent map opens instead */
  }
}

/**
 * Before `loadMapIndex`: make the remembered map the active one when it is still in the
 * index, so the boot opens it rather than the most recently saved one.
 */
export async function restoreOpenMap(
  db: { getAllMapMeta(): Promise<{ id: string }[]> },
  store: typeof useStore = useStore,
): Promise<void> {
  const id = rememberedOpenMap();
  if (!id || store.getState().activeMapId) return;
  const metas = await db.getAllMapMeta();
  if (metas.some((m) => m.id === id)) store.setState({ activeMapId: id });
}

/** Write the open map down whenever it changes. Returns the unsubscribe. */
export function trackOpenMap(store: typeof useStore = useStore): () => void {
  return store.subscribe((s, prev) => {
    if (s.activeMapId !== prev.activeMapId) remember(s.activeMapId);
  });
}
