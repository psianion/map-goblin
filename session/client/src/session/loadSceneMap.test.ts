import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';
import { loadSceneMap } from './loadSceneMap';

// ponytail: the GameRenderer mount itself needs WebGL, so jsdom can only cover
// the seam below it — fetch → store. Playwright (I2) drives the real Pixi mount.
/** One dungeon layer holding a secret door, an ordinary door and something that is neither. */
function docWithSecretDoor() {
  return {
    version: '3.0',
    layers: [
      {
        id: 'l1',
        type: 'dungeon',
        children: [
          { id: 'd1', childType: 'door', isSecret: true, name: 'Hidden 1' },
          { id: 'd2', childType: 'door', isSecret: false, name: 'Single 1' },
          { id: 'o1', childType: 'object', name: 'Barrel' },
        ],
      },
      { id: 'l2', type: 'image' },
    ],
  };
}

function stubFetch(doc: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => doc });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function childIds(): string[] {
  const data = useSessionStore.getState().mapData as { layers: { children?: { id: string }[] }[] };
  return data.layers.flatMap((l) => l.children?.map((c) => c.id) ?? []);
}

describe('loadSceneMap', () => {
  beforeEach(() => useSessionStore.setState({ mapData: null, you: null }));
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the scene with the session token and stores the document', async () => {
    const doc = { version: '3.0', layers: [] };
    const fetchMock = stubFetch(doc);

    await loadSceneMap('scene 1', 'tok-abc');

    expect(fetchMock).toHaveBeenCalledWith(`${endpoints.httpBase}/api/maps/scene%201`, {
      headers: { Authorization: 'Bearer tok-abc' },
    });
    expect(useSessionStore.getState().mapData).toEqual(doc);
  });

  it('strips secret doors before a player can render them', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'p1', name: 'Bob', role: 'player', connected: true },
    });

    await loadSceneMap('s1', 'tok');

    // The secret door is gone; the ordinary door and the non-door child are untouched.
    expect(childIds()).toEqual(['d2', 'o1']);
  });

  it('leaves secret doors in place for the DM', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true },
    });

    await loadSceneMap('s1', 'tok');

    expect(childIds()).toEqual(['d1', 'd2', 'o1']);
  });

  it('strips secret doors when the role is not known yet', async () => {
    stubFetch(docWithSecretDoor());

    await loadSceneMap('s1', 'tok');

    expect(childIds()).toEqual(['d2', 'o1']);
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
