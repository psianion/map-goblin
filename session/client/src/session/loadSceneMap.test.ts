import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';
import { loadSceneMap } from './loadSceneMap';

// ponytail: the GameRenderer mount itself needs WebGL, so jsdom can only cover
// the seam below it — fetch → store. Playwright (I2) drives the real Pixi mount.
describe('loadSceneMap', () => {
  beforeEach(() => useSessionStore.setState({ mapData: null }));
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the scene with the session token and stores the document', async () => {
    const doc = { version: '3.0', layers: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => doc,
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadSceneMap('scene 1', 'tok-abc');

    expect(fetchMock).toHaveBeenCalledWith(`${endpoints.httpBase}/api/maps/scene%201`, {
      headers: { Authorization: 'Bearer tok-abc' },
    });
    expect(useSessionStore.getState().mapData).toBe(doc);
  });

  it('rejects on a non-OK response and leaves mapData untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }),
    );

    await expect(loadSceneMap('s1', 'tok')).rejects.toThrow('403');
    expect(useSessionStore.getState().mapData).toBeNull();
  });
});
