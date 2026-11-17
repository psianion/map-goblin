import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { SceneMeta } from '../session/auth';
import { useSessionStore } from '../session/store';

vi.mock('@dnd/core/src/engine/engineSingleton', () => ({
  getEngineSingleton: () => ({ engine: {}, sceneGraph: {} }),
}));
vi.mock('@dnd/core/src/engine/export/exportPipeline', () => ({
  computeMapWorldBounds: () => ({ minX: 0, minY: 0, maxX: 30, maxY: 20 }),
  runExportPipeline: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), filename: 'x.jpg' })),
}));

const { THUMBNAIL_SETTLE_MS, sceneNeedingThumbnail, watchSceneThumbnails } = await import('./thumbnail');

const scene = (over: Partial<SceneMeta> = {}): SceneMeta => ({
  id: 's1',
  name: 'Goblin Warren',
  sortIndex: 0,
  visibleToPlayers: true,
  mapId: 'm1',
  updatedAt: 0,
  ...over,
});
const loaded = { sceneId: 's1', mapId: 'm1' };

describe('sceneNeedingThumbnail (F20)', () => {
  it('pictures the loaded scene only for the DM, only when it has none, and only once', () => {
    expect(sceneNeedingThumbnail([scene()], loaded, 'dm', new Set())?.id).toBe('s1');
    expect(sceneNeedingThumbnail([scene({ thumbnail: true })], loaded, 'dm', new Set())).toBeNull();
    expect(sceneNeedingThumbnail([scene()], loaded, 'player', new Set())).toBeNull();
    expect(sceneNeedingThumbnail([scene()], loaded, 'dm', new Set(['m1']))).toBeNull();
    // A republish is a new map row: the old row's picture says nothing about it.
    expect(sceneNeedingThumbnail([scene({ mapId: 'm2' })], loaded, 'dm', new Set())).toBeNull();
    expect(sceneNeedingThumbnail([scene()], null, 'dm', new Set())).toBeNull();
  });
});

describe('watchSceneThumbnails (F20)', () => {
  const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
  let calls: { url: string; method: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        const body = url.includes('/scenes') ? { scenes: [scene()] } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    useSessionStore.setState({
      you: dm,
      token: 'tok',
      session: { campaignId: 'c1' } as never,
      loadedScene: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uploads a picture for a loaded scene that has none, over the existing route', async () => {
    const detach = watchSceneThumbnails();
    useSessionStore.setState({ loadedScene: loaded });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_SETTLE_MS + 10);
    detach();
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/api/maps/m1/thumbnail'))).toBe(true);
  });

  it('sends nothing from a player seat', async () => {
    useSessionStore.setState({ you: { ...dm, role: 'player' } });
    const detach = watchSceneThumbnails();
    useSessionStore.setState({ loadedScene: loaded });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_SETTLE_MS + 10);
    detach();
    expect(calls).toEqual([]);
  });
});
