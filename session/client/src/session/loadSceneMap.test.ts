import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';
import { loadSceneMap, mergeMapDelta, type MapDelta } from './loadSceneMap';

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

// ── Reveal deltas (D5) ──────────────────────────────────────────────────────

/** A player's copy: one explored room, its wall, and the door onto the dark. */
const loaded = (): SerializedMapData =>
  ({
    version: '3.0',
    layers: [
      {
        id: 'l1',
        type: 'dungeon',
        rooms: [{ id: 'r-vestibule' }],
        children: [
          { id: 'd-vg', childType: 'door', isSecret: false, state: 'closed', roomA: 'r-vestibule', roomB: null },
        ],
        standaloneWalls: [{ id: 'w1' }],
        mergedFloor: null,
      },
      { id: 'l2', type: 'image' },
    ],
  }) as unknown as SerializedMapData;

const delta = (over: Partial<MapDelta> = {}): MapDelta => ({
  sceneId: 'scene-1',
  layers: [
    {
      id: 'l1',
      rooms: [{ id: 'r-gallery' }],
      // The shared door arrives a second time, now bound to both sides.
      children: [
        { id: 'd-vg', childType: 'door', isSecret: false, state: 'closed', roomA: 'r-vestibule', roomB: 'r-gallery' },
        { id: 'd-gv', childType: 'door', isSecret: false, state: 'closed', roomA: 'r-gallery', roomB: null },
      ],
      standaloneWalls: [{ id: 'w1' }, { id: 'w2' }],
    },
  ],
  ...over,
}) as MapDelta;

const layerOf = (data: SerializedMapData | null) =>
  (data!.layers[0] as unknown as {
    rooms: { id: string }[];
    children: { id: string; roomB?: string | null }[];
    standaloneWalls: { id: string }[];
  });

describe('mergeMapDelta', () => {
  it('upserts by id — a door arriving twice is updated, never duplicated', () => {
    const merged = mergeMapDelta(loaded(), delta(), 'player', 'scene-1');
    const layer = layerOf(merged);

    expect(layer.children.map((c) => c.id)).toEqual(['d-vg', 'd-gv']);
    // The second copy wins: it is the one that knows about the room just revealed.
    expect(layer.children[0].roomB).toBe('r-gallery');
    expect(layer.standaloneWalls.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(layer.rooms.map((r) => r.id)).toEqual(['r-vestibule', 'r-gallery']);
  });

  it('leaves the merged floor for core to rebuild, as the server sent it', () => {
    const merged = mergeMapDelta(loaded(), delta(), 'player', 'scene-1');
    expect((merged!.layers[0] as unknown as { mergedFloor: unknown }).mergedFloor).toBeNull();
  });

  it('never lets a secret door in through the delta either', () => {
    const sneaky = delta();
    sneaky.layers[0].children.push({
      id: 'd-secret',
      childType: 'door',
      isSecret: true,
    } as unknown as MapDelta['layers'][number]['children'][number]);

    const asPlayer = mergeMapDelta(loaded(), sneaky, 'player', 'scene-1');
    expect(layerOf(asPlayer).children.map((c) => c.id)).not.toContain('d-secret');

    const asDm = mergeMapDelta(loaded(), sneaky, 'dm', 'scene-1');
    expect(layerOf(asDm).children.map((c) => c.id)).toContain('d-secret');
  });

  it('drops a delta for a scene this client is no longer looking at', () => {
    const current = loaded();
    expect(mergeMapDelta(current, delta({ sceneId: 'scene-2' }), 'player', 'scene-1')).toBe(current);
  });

  it('drops a layer the client does not hold rather than inventing one', () => {
    const merged = mergeMapDelta(
      loaded(),
      delta({ layers: [{ id: 'l-unknown', rooms: [], children: [], standaloneWalls: [] }] }),
      'player',
      'scene-1',
    );
    expect(merged!.layers).toHaveLength(2);
  });

  it('is a no-op before the map has landed, and on an empty delta', () => {
    expect(mergeMapDelta(null, delta(), 'player', 'scene-1')).toBeNull();
    const current = loaded();
    expect(mergeMapDelta(current, delta({ layers: [] }), 'player', 'scene-1')).toBe(current);
  });
});

describe('state-update carrying a mapDelta', () => {
  const session = {
    protocolVersion: 3,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
    players: [],
    modules: {},
  };

  it('lands the geometry and the fog state in one store write (D5)', () => {
    useSessionStore.setState({
      session: session as never,
      you: { identityId: 'p1', name: 'Ayla', role: 'player', connected: true },
      mapData: loaded(),
    });

    useSessionStore.getState().applyServerMessage({
      type: 'state-update',
      module: 'fog',
      state: { byScene: { 'scene-1': { rooms: { 'r-gallery': { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true } } },
      mapDelta: delta(),
    } as never);

    const state = useSessionStore.getState();
    const layer = layerOf(state.mapData as SerializedMapData);
    expect(layer.rooms.map((r) => r.id)).toContain('r-gallery');
    expect(state.session!.modules.fog).toBeTruthy();
  });

  it('leaves the map alone on a state-update that carries no delta', () => {
    const current = loaded();
    useSessionStore.setState({ session: session as never, you: null, mapData: current });

    useSessionStore.getState().applyServerMessage({
      type: 'state-update',
      module: 'doors',
      state: { byScene: {} },
    } as never);

    expect(useSessionStore.getState().mapData).toBe(current);
  });
});
