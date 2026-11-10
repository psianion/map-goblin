import { describe, it, expect, afterEach, vi } from 'vitest';
import { currentHashes, decidePublish, sendThumbnail } from './publishFlow';
import { deserializeFromBytes, serializeToBytes } from './saveLoad';
import { useStore } from '@/store/store';
import { createImageLayer } from '@dnd/core/src/store/factories';
import {
  PublishGoneError,
  UNREACHABLE_MESSAGE,
  listCampaigns,
  putScenePrep,
  republishScene,
  uploadMap,
} from './publish';

const { capture } = vi.hoisted(() => ({ capture: vi.fn<() => Promise<Blob | null>>() }));
vi.mock('@/io/mapThumbnail', () => ({ captureTableThumbnail: capture }));

const target = { sceneId: 's1', mapHash: 'h1', prepHash: 'p1' };

describe('sendThumbnail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts the table picture on the map row the publish answered', async () => {
    const image = new Blob(['jpeg'], { type: 'image/jpeg' });
    capture.mockResolvedValue(image);
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    await sendThumbnail('tok', 'm1');
    expect(fetchSpy).toHaveBeenCalledWith('/api/maps/m1/thumbnail', {
      method: 'PUT',
      headers: { authorization: 'Bearer tok', 'content-type': 'image/jpeg' },
      body: image,
    });
  });

  it('never fails the publish: a refused upload or a render that throws resolves quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    capture.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'too big' }), { status: 413 })));
    await expect(sendThumbnail('tok', 'm1')).resolves.toBeUndefined();
    capture.mockRejectedValue(new Error('no WebGL'));
    await expect(sendThumbnail('tok', 'm1')).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    capture.mockResolvedValue(new Blob(['jpeg']));
    await expect(sendThumbnail('tok', 'm1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('sends nothing with no canvas to draw from', async () => {
    capture.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await sendThumbnail('tok', 'm1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

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

describe('what a publish sends', () => {
  it('leaves the trace layers and their pictures out of the published bytes and the hash', async () => {
    const s = useStore.getState();
    s.resetToDefault();
    const { hash: before } = await currentHashes();
    s.addCustomImage('sketch', 'data:image/png;base64,AAAA');
    useStore.getState().addLayer(createImageLayer(s.levels[0].id, 'sketch', 'cellars-sketch.png'));
    const { data, hash } = await currentHashes();
    const sent = await deserializeFromBytes(await serializeToBytes(data));
    expect(sent.layers.some((l) => l.type === 'image')).toBe(false);
    expect(sent.customImages.sketch).toBeUndefined();
    // A trace is no change to the map the table holds.
    expect(hash).toBe(before);
  });
});
