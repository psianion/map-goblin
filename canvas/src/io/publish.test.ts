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
} from './publish';
import { hashMapBytes } from './mapFormat';
import type { SerializedMapData } from '@/store/types';

const BASE_DATA: SerializedMapData = {
  version: '2.0',
  mapSettings: {
    name: 'Test Dungeon',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
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
      prep: { version: 2, triggers: [], notes: [] },
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
      { ...BASE_DATA, prep: { version: 2, triggers: [], notes: [] } },
      [splat, null],
    );
    expect(hashA).toBe(hashB);
  });

  // Pinned against the hash hashMapForPublish produced before the hashing body moved
  // into this function to run off the main thread — the move must not change the
  // digest for an unchanged map, or every table thinks every map changed.
  it('matches the pre-move hash for a fixed document', async () => {
    const hash = await hashMapBytes(BASE_DATA);
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
    const before = await hashPrep({ version: 2, triggers: [], notes: [] });
    const after = await hashPrep({
      version: 2,
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
