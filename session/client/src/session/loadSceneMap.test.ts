import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';
import {
  swapSceneMap,
  invalidateSceneDocs,
  mergeMapDelta,
  type MapDelta,
} from './loadSceneMap';

// Real `restoreCustomImages` decodes data URLs through Pixi, which needs a GPU jsdom has
// not got. What matters at this seam is *that* it runs, and that it runs before the
// document lands — so the spy also records what the store held when it was called.
vi.mock('@dnd/core/src/assets/textureLoader', () => ({
  restoreCustomImages: vi.fn(async () => {
    mapDataDuringRestore = useSessionStore.getState().mapData;
  }),
  registerImageBlob: vi.fn(async () => {}),
}));
// Texture warm-up walks the asset packs, which live behind IndexedDB — out of jsdom's
// reach and beside the point at this seam (swapSceneMap treats a preload failure as soft).
vi.mock('@dnd/core/src/engine/floorWallRenderer', () => ({
  preloadLayerTextures: vi.fn(async () => false),
}));
const { restoreCustomImages, registerImageBlob } = await import(
  '@dnd/core/src/assets/textureLoader'
);
let mapDataDuringRestore: unknown = 'never ran';

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

/** A session whose `doors` slice says the DM has let the party in on `d1` (D2). */
const secretRevealed = (revealed: boolean) =>
  ({
    activeSceneId: 's1',
    modules: {
      doors: { byScene: { s1: { d1: { open: false, locked: false, revealed } } } },
    },
  }) as never;

describe('swapSceneMap', () => {
  beforeEach(() => {
    useSessionStore.setState({ mapData: null, loadedScene: null, you: null, session: null });
    // The doc cache outlives a test the way it outlives a scene switch — flush it, or a
    // later test's fetch stub never runs and it quietly asserts against this test's doc.
    for (const id of ['s1', 'scene 1', 'sA', 'sB']) invalidateSceneDocs(id);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the scene with the session token and stores the document', async () => {
    const doc = { version: '3.0', layers: [] };
    const fetchMock = stubFetch(doc);

    await swapSceneMap('scene 1', 'm1', 'tok-abc');

    expect(fetchMock).toHaveBeenCalledWith(
      `${endpoints.httpBase}/api/maps/scene%201?images=external`,
      { headers: { Authorization: 'Bearer tok-abc' } },
    );
    expect(useSessionStore.getState().mapData).toEqual(doc);
    expect(useSessionStore.getState().loadedScene).toEqual({ sceneId: 'scene 1', mapId: 'm1' });
  });

  it('serves a scene the table already visited from cache, without a refetch', async () => {
    const docA = { version: '3.0', layers: [], name: 'A' };
    const docB = { version: '3.0', layers: [], name: 'B' };
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('sA') ? docA : docB),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await swapSceneMap('sA', 'mA', 'tok');
    await swapSceneMap('sB', 'mB', 'tok');
    const fetches = fetchMock.mock.calls.length;

    await swapSceneMap('sA', 'mA', 'tok'); // back again — the visit that must be instant

    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect((useSessionStore.getState().mapData as { name: string }).name).toBe('A');
    // …while a republish (same scene, new map id) is a miss on purpose.
    await swapSceneMap('sA', 'mA2', 'tok');
    expect(fetchMock.mock.calls.length).toBe(fetches + 1);
  });

  it('lets a newer switch supersede a slower one mid-flight', async () => {
    const docA = { version: '3.0', layers: [], name: 'A' };
    const docB = { version: '3.0', layers: [], name: 'B' };
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('sA')) await gateA; // sA's fetch is the slow one
        return { ok: true, json: async () => (url.includes('sA') ? docA : docB) };
      }),
    );

    const slow = swapSceneMap('sA', 'mA', 'tok');
    await swapSceneMap('sB', 'mB', 'tok'); // the DM already moved on
    releaseA();
    await slow;

    // The stale result must not clobber the scene the table actually shows.
    expect((useSessionStore.getState().mapData as { name: string }).name).toBe('B');
    expect(useSessionStore.getState().loadedScene).toEqual({ sceneId: 'sB', mapId: 'mB' });
  });

  it('fetches externalized images as binary — splats to the store, pictures to Pixi', async () => {
    const doc = {
      version: '3.0',
      layers: [],
      customImages: {},
      imageKeys: ['__terrain-splat-0__', 'asset-1'],
    };
    const splatBlob = new Blob(['s'], { type: 'image/png' });
    const picBlob = new Blob(['p'], { type: 'image/png' });
    const restoresBefore = vi.mocked(restoreCustomImages).mock.calls.length;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/images/')) {
        return { ok: true, blob: async () => (url.includes('splat') ? splatBlob : picBlob) };
      }
      return { ok: true, json: async () => doc };
    });
    vi.stubGlobal('fetch', fetchMock);

    await swapSceneMap('s1', 'm1', 'tok');

    expect(fetchMock).toHaveBeenCalledWith(
      `${endpoints.httpBase}/api/maps/s1/images/__terrain-splat-0__`,
      { headers: { Authorization: 'Bearer tok' } },
    );
    expect(registerImageBlob).toHaveBeenCalledWith('asset-1', picBlob);
    expect(useSessionStore.getState().splatPngs).toEqual([splatBlob, null]);
    // The document itself no longer carries image payloads.
    expect(vi.mocked(restoreCustomImages).mock.calls.length).toBe(restoresBefore);
  });

  /**
   * The images the DM imported in the editor travel inside the map file, and the table
   * registered none of them: `loadFromFile` resolves textures as it builds the scene
   * graph, so every imported picture rendered as the magenta fallback on both seats.
   * Ordering is the assertion — registering after the document lands is still too late.
   */
  it('registers the document’s imported images before the document lands', async () => {
    const customImages = { 'asset-1': 'data:image/png;base64,AAA' };
    stubFetch({ version: '3.0', layers: [], customImages });

    await swapSceneMap('s1', 'm1', 'tok');

    expect(restoreCustomImages).toHaveBeenCalledWith(customImages);
    expect(mapDataDuringRestore).toBeNull();
  });

  it('strips secret doors before a player can render them', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'p1', name: 'Bob', role: 'player', connected: true },
    });

    await swapSceneMap('s1', 'm1', 'tok');

    // The secret door is gone; the ordinary door and the non-door child are untouched.
    expect(childIds()).toEqual(['d2', 'o1']);
  });

  it('leaves secret doors in place for the DM', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true },
    });

    await swapSceneMap('s1', 'm1', 'tok');

    expect(childIds()).toEqual(['d1', 'd2', 'o1']);
  });

  /**
   * The other half of D2. The server only sends a secret door's child once the DM has
   * revealed it *and* the party has explored a room it is bound to; a filter that reads the
   * authored `isSecret` flag alone throws that away again, and the door reaches the player's
   * door state and never their map — on a broadcast, a reload or a restart alike.
   */
  it('keeps a secret door this seat has been let in on (D2)', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'p1', name: 'Bob', role: 'player', connected: true },
      session: secretRevealed(true),
    });

    await swapSceneMap('s1', 'm1', 'tok');

    expect(childIds()).toEqual(['d1', 'd2', 'o1']);
  });

  it('drops it again when the seat’s own doors slice does not name it revealed', async () => {
    stubFetch(docWithSecretDoor());
    useSessionStore.setState({
      you: { identityId: 'p1', name: 'Bob', role: 'player', connected: true },
      session: secretRevealed(false),
    });

    await swapSceneMap('s1', 'm1', 'tok');

    expect(childIds()).toEqual(['d2', 'o1']);
  });

  it('strips secret doors when the role is not known yet', async () => {
    stubFetch(docWithSecretDoor());

    await swapSceneMap('s1', 'm1', 'tok');

    expect(childIds()).toEqual(['d2', 'o1']);
  });

  it('rejects on a non-OK response and leaves mapData untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }),
    );

    await expect(swapSceneMap('s1', 'm1', 'tok')).rejects.toThrow('403');
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

  /**
   * The portcullis that shut on its own. The lighting lane writes the table's live door
   * state onto the map's own door children (`doorLighting`), and the server's delta carries
   * the *authored* child — so replacing it wholesale swung an already-open door shut, with
   * its occlusion, and nobody had touched it.
   */
  it('keeps a door the table has open open when a reveal re-sends it', () => {
    const open = loaded();
    // What `syncDoorsToLighting` wrote after the party opened it.
    (open.layers[0] as unknown as { children: { state: string }[] }).children[0].state = 'open';

    const merged = mergeMapDelta(open, delta(), 'player', 'scene-1');
    const door = layerOf(merged).children[0] as unknown as { state: string; roomB?: string | null };
    expect(door.state).toBe('open');
    // …and the delta still wins on everything it is actually authoritative for.
    expect(door.roomB).toBe('r-gallery');
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

  it('does let a revealed one through — that delta is the DM saying so (D2)', () => {
    const withSecret = delta();
    withSecret.layers[0].children.push({
      id: 'd-secret',
      childType: 'door',
      isSecret: true,
    } as unknown as MapDelta['layers'][number]['children'][number]);
    // The doors slice is the server's own answer, already cut to `revealed && explored`, so
    // the reveal-secret frame that carries the child arrives after the one that names it.
    useSessionStore.setState({
      session: {
        activeSceneId: 'scene-1',
        modules: {
          doors: { byScene: { 'scene-1': { 'd-secret': { open: false, locked: false, revealed: true } } } },
        },
      } as never,
    });

    const merged = mergeMapDelta(loaded(), withSecret, 'player', 'scene-1');
    expect(layerOf(merged).children.map((c) => c.id)).toContain('d-secret');
    useSessionStore.setState({ session: null });
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
    protocolVersion: PROTOCOL_VERSION,
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

  /**
   * The F2 race. `scene-changed` flips `activeSceneId` immediately; the outgoing document
   * stays in hand until the swap lands. A reveal delta for the *incoming* scene arriving in
   * that window must not merge into the outgoing map — the swap's own fetch answers with
   * the post-reveal document, so dropping it costs nothing.
   */
  it('drops a delta for the scene being switched to while the old document is still held', () => {
    const current = loaded();
    useSessionStore.setState({
      session: { ...session, activeSceneId: 'scene-2' } as never, // already flipped
      you: { identityId: 'p1', name: 'Ayla', role: 'player', connected: true },
      mapData: current,
      loadedScene: { sceneId: 'scene-1', mapId: 'm1' }, // still holding the old scene
    });

    useSessionStore.getState().applyServerMessage({
      type: 'state-update',
      module: 'fog',
      state: { byScene: {} },
      mapDelta: delta({ sceneId: 'scene-2' }),
    } as never);

    expect(useSessionStore.getState().mapData).toBe(current);
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
