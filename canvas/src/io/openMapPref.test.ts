import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { OPEN_MAP_KEY, restoreOpenMap, trackOpenMap } from './openMapPref';

// Newest first, as the index sorts them: "Kept" was saved last.
const db = { getAllMapMeta: async () => [{ id: 'kept' }, { id: 'untitled' }] };

let stop: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ activeMapId: null });
});
afterEach(() => stop());

describe('reload keeps the open map', () => {
  it('the map open before the reload is active again, not the newest save', async () => {
    stop = trackOpenMap();
    useStore.setState({ activeMapId: 'kept' });
    useStore.setState({ activeMapId: 'untitled' });
    stop();
    // The reload: a fresh store, the remembered id read back before the index loads.
    useStore.setState({ activeMapId: null });
    await restoreOpenMap(db);
    expect(useStore.getState().activeMapId).toBe('untitled');
  });

  it('a remembered map that is gone leaves the newest to win', async () => {
    localStorage.setItem(OPEN_MAP_KEY, 'deleted');
    await restoreOpenMap(db);
    expect(useStore.getState().activeMapId).toBeNull();
  });

  it('closing the open map forgets it', () => {
    stop = trackOpenMap();
    useStore.setState({ activeMapId: 'kept' });
    useStore.setState({ activeMapId: null });
    expect(localStorage.getItem(OPEN_MAP_KEY)).toBeNull();
  });
});
