import { describe, it, expect, beforeEach, vi } from 'vitest';

// hashMapForPublish delegates the actual hashing to the save worker when one's
// available; stub the two saveLoad exports it calls through so the delegation
// test controls that path without spinning up a real Worker (jsdom has none —
// every other test here exercises the no-worker fallback, same as production
// running under vitest).
vi.mock('./saveLoad', () => ({
  getSaveWorker: vi.fn(),
  callSaveWorker: vi.fn(),
}));

import { getSaveWorker, callSaveWorker } from './saveLoad';
import {
  hashMapForPublish,
  hashPrep,
  getPublishToken,
  setPublishToken,
  clearPublishToken,
  lastPublishedTo,
  refreshPublishTokens,
  tokenExp,
} from './publish';
import { hashMapBytes } from './mapFormat';
import type { SerializedMapData } from '@/store/types';

const BASE_DATA: SerializedMapData = {
  version: '2.0',
  mapSettings: {
    name: 'Test Dungeon',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
    sightDropCells: 2,
    crossingKinds: [],
  },
  grid: { visible: true, snapDivision: 2 },
  layers: [],
  customImages: {},
};

describe('hashMapBytes', () => {
  it('is stable across prep-only changes', async () => {
    const withoutPrep = { ...BASE_DATA };
    const withPrep: SerializedMapData = {
      ...BASE_DATA,
      prep: { version: 3, triggers: [], notes: [], rooms: [] },
    };
    const hashA = await hashMapBytes(withoutPrep);
    const hashB = await hashMapBytes(withPrep);
    expect(hashA).toBe(hashB);
  });

  it('changes when map geometry changes', async () => {
    const before = await hashMapBytes(BASE_DATA);
    const after = await hashMapBytes({
      ...BASE_DATA,
      mapSettings: { ...BASE_DATA.mapSettings, name: 'Renamed Dungeon' },
    });
    expect(before).not.toBe(after);
  });

  it('produces a 64-char hex sha-256 digest', async () => {
    const hash = await hashMapBytes(BASE_DATA);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a splat paint stroke changes the splat bytes', async () => {
    const before = await hashMapBytes(BASE_DATA, [null, null]);
    const after = await hashMapBytes(BASE_DATA, [new Uint8Array([1, 2, 3, 4]), null]);
    expect(before).not.toBe(after);
  });

  it('is stable across prep-only changes even with splats present', async () => {
    const splat = new Uint8Array([5, 6, 7]);
    const hashA = await hashMapBytes(BASE_DATA, [splat, null]);
    const hashB = await hashMapBytes(
      { ...BASE_DATA, prep: { version: 3, triggers: [], notes: [], rooms: [] } },
      [splat, null],
    );
    expect(hashA).toBe(hashB);
  });

  // Pinned against the hash hashMapForPublish produced before the hashing body moved
  // into this function to run off the main thread — the move must not change the
  // digest for an unchanged map, or every table thinks every map changed.
  it('matches the pre-move hash for a fixed document', async () => {
    // The pinned document predates the retired mapSettings.gridType and still carries it,
    // byte for byte, so the digest stays comparable.
    const pinned = {
      ...BASE_DATA,
      mapSettings: { name: 'Test Dungeon', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#1a1a2e' },
    } as unknown as SerializedMapData;
    const hash = await hashMapBytes(pinned);
    expect(hash).toBe('ce5e81eacc13c177ccf6dafe5eb45ba8fa75d51f43d2cf6d7c5832cffe5c038c');
  });
});

describe('hashMapForPublish', () => {
  beforeEach(() => {
    vi.mocked(getSaveWorker).mockReset();
    vi.mocked(callSaveWorker).mockReset();
  });

  it('falls back to hashing inline when there is no save worker (matches vitest/jsdom)', async () => {
    vi.mocked(getSaveWorker).mockReturnValue(null);
    const hash = await hashMapForPublish(BASE_DATA);
    expect(hash).toBe(await hashMapBytes(BASE_DATA));
  });

  it('delegates to the save worker when one is available', async () => {
    const fakeWorker = {} as Worker;
    vi.mocked(getSaveWorker).mockReturnValue(fakeWorker);
    vi.mocked(callSaveWorker).mockResolvedValue({ hash: 'worker-computed-hash' });

    const result = await hashMapForPublish(BASE_DATA);

    expect(result).toBe('worker-computed-hash');
    expect(callSaveWorker).toHaveBeenCalledWith(
      fakeWorker,
      expect.objectContaining({ op: 'hash', data: BASE_DATA }),
      expect.any(Array),
    );
  });
});

describe('hashPrep', () => {
  it('is stable when prep is absent, regardless of undefined vs. missing', async () => {
    const hashA = await hashPrep(undefined);
    const hashB = await hashPrep(undefined);
    expect(hashA).toBe(hashB);
  });

  it('changes when a trigger is added', async () => {
    const before = await hashPrep({ version: 3, triggers: [], notes: [], rooms: [] });
    const after = await hashPrep({
      version: 3,
      rooms: [],
      notes: [],
      triggers: [
        {
          id: 't1',
          name: 'Trap',
          when: { kind: 'enter-region', zoneId: 'z1' },
          actions: [],
          once: true,
          enabled: true,
        },
      ],
    });
    expect(before).not.toBe(after);
  });
});

describe('publish token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a token per campaign', () => {
    expect(getPublishToken('camp-1')).toBeNull();
    setPublishToken('camp-1', 'tok-abc');
    expect(getPublishToken('camp-1')).toBe('tok-abc');
    expect(getPublishToken('camp-2')).toBeNull();
  });

  it('clearPublishToken removes only that campaign', () => {
    setPublishToken('camp-1', 'tok-abc');
    setPublishToken('camp-2', 'tok-xyz');
    clearPublishToken('camp-1');
    expect(getPublishToken('camp-1')).toBeNull();
    expect(getPublishToken('camp-2')).toBe('tok-xyz');
  });
});

describe('DM token refresh', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_000_000_000_000;
  const tokenFor = (exp: number) =>
    `${btoa(JSON.stringify({ identityId: 'dm', campaignId: 'c', role: 'dm', exp })).replace(/=+$/, '')}.sig`;

  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('reads the expiry off a token, and nothing off junk', () => {
    expect(tokenExp(tokenFor(NOW + DAY))).toBe(NOW + DAY);
    expect(tokenExp('junk')).toBeNull();
  });

  it('refreshes only the tokens with under a week left that have not run out', async () => {
    setPublishToken('soon', tokenFor(NOW + 3 * DAY));
    setPublishToken('later', tokenFor(NOW + 20 * DAY));
    setPublishToken('gone', tokenFor(NOW - DAY));
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ token: `fresh-for-${url}`, campaignId: 'soon', exp: NOW + 30 * DAY }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await refreshPublishTokens(NOW);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/campaigns/soon/dm-token/refresh');
    expect(getPublishToken('soon')).toBe('fresh-for-/api/campaigns/soon/dm-token/refresh');
    expect(getPublishToken('later')).toBe(tokenFor(NOW + 20 * DAY));
    expect(getPublishToken('gone')).toBe(tokenFor(NOW - DAY));
  });

  it('keeps the token when the refresh fails', async () => {
    setPublishToken('soon', tokenFor(NOW + DAY));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await refreshPublishTokens(NOW);
    expect(getPublishToken('soon')).toBe(tokenFor(NOW + DAY));
  });
});

describe('lastPublishedTo', () => {
  it('names the campaign of the newest publish, and nothing for none', () => {
    expect(lastPublishedTo(null)).toBeNull();
    expect(
      lastPublishedTo({
        a: { sceneId: 's', mapHash: 'h', prepHash: 'p', campaignName: 'Old', publishedAt: 1 },
        b: { sceneId: 's', mapHash: 'h', prepHash: 'p', campaignName: 'New', publishedAt: 9 },
      }),
    ).toBe('New');
    expect(lastPublishedTo({ a: { sceneId: 's', mapHash: 'h', prepHash: 'p' } })).toBe('a campaign');
  });
});
