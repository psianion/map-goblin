import { describe, it, expect, afterEach, vi } from 'vitest';
import { decidePublish } from './publishFlow';
import {
  PublishGoneError,
  UNREACHABLE_MESSAGE,
  listCampaigns,
  putScenePrep,
  republishScene,
  uploadMap,
} from './publish';

const target = { sceneId: 's1', mapHash: 'h1', prepHash: 'p1' };

describe('decidePublish', () => {
  it.each([
    ['never published', null, 'h1', 'p1', false, 'upload'],
    ['never published, forced', null, 'h1', 'p1', true, 'upload'],
    ['map changed', target, 'h2', 'p1', false, 'republish'],
    ['map and prep changed', target, 'h2', 'p2', false, 'republish'],
    ['only prep changed', target, 'h1', 'p2', false, 'prep'],
    ['nothing changed', target, 'h1', 'p1', false, 'none'],
    ['nothing changed, forced', target, 'h1', 'p1', true, 'republish'],
  ] as const)('%s → %s', (_name, t, hash, prepHash, force, expected) => {
    expect(decidePublish(t, hash, prepHash, force)).toBe(expected);
  });
});

describe('PublishGoneError', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no such scene' }), { status })),
    );

  it('is thrown on a 404 from republish', async () => {
    answer(404);
    await expect(republishScene('tok', 's1', new Uint8Array([1]))).rejects.toBeInstanceOf(PublishGoneError);
  });

  it('is thrown on a 404 from prep', async () => {
    answer(404);
    await expect(
      putScenePrep('tok', 's1', { version: 3, triggers: [], notes: [], rooms: [] }),
    ).rejects.toBeInstanceOf(PublishGoneError);
  });

  it('is not thrown for other failures, or a 404 on a first upload', async () => {
    answer(500);
    await expect(republishScene('tok', 's1', new Uint8Array([1]))).rejects.not.toBeInstanceOf(PublishGoneError);
    answer(404);
    await expect(uploadMap('tok', 'c1', new Uint8Array([1]))).rejects.not.toBeInstanceOf(PublishGoneError);
  });
});

describe('a table server that cannot be reached', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says so when the request never gets an answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(listCampaigns('pass')).rejects.toThrow(UNREACHABLE_MESSAGE);
  });

  it.each([
    ['the dev proxy', 500, ''],
    ['a tunnel', 502, '<html><body>Bad gateway</body></html>'],
    ['a tunnel timing out', 504, 'Gateway Timeout'],
  ])('says so for a 5xx from %s with no error of its own', async (_name, status, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status })));
    await expect(republishScene('tok', 's1', new Uint8Array([1]))).rejects.toThrow(UNREACHABLE_MESSAGE);
  });

  it("keeps the server's own error from a 5xx", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'disk full' }), { status: 500 })));
    await expect(uploadMap('tok', 'c1', new Uint8Array([1]))).rejects.toThrow('disk full');
  });
});
