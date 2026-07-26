import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../endpoints';
import { createCampaignAsDm, joinAsPlayer, startSession, uploadMapFile } from './auth';

/** One stub fetch, told what to answer with. */
function answer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const before = { ...endpoints };

beforeEach(() => Object.assign(endpoints, before));
afterEach(() => vi.restoreAllMocks());

describe('createCampaignAsDm', () => {
  it('retargets every endpoint at the typed-in server and returns the DM token', async () => {
    const fetchMock = answer(201, { campaignId: 'c1', identityId: 'dm-1', token: 'dm-token' });

    const dm = await createCampaignAsDm('http://box.local:8787', 'hunter2', 'Lost Mine');

    expect(dm).toEqual({ campaignId: 'c1', identityId: 'dm-1', token: 'dm-token' });
    expect(endpoints.httpBase).toBe('http://box.local:8787');
    expect(endpoints.wsBase).toBe('ws://box.local:8787/ws');
    // The renderer's texture packs are not on the game server (S1) — assetBase stays put.
    expect(endpoints.assetBase).toBe(before.assetBase);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://box.local:8787/api/campaigns');
    expect(init.body).toBe(JSON.stringify({ name: 'Lost Mine' }));
    expect(init.headers).toMatchObject({ Authorization: 'Bearer hunter2' });
  });

  it('speaks wss for an https server', async () => {
    answer(201, {});
    await createCampaignAsDm('https://table.example.com', 'p', 'c');
    expect(endpoints.wsBase).toBe('wss://table.example.com/ws');
  });

  it('assumes http:// for the bare host:port a DM types first', async () => {
    answer(201, {});
    await createCampaignAsDm('localhost:8787', 'p', 'c');
    expect(endpoints.httpBase).toBe('http://localhost:8787');
    expect(endpoints.wsBase).toBe('ws://localhost:8787/ws');
  });

  it('refuses a server address the browser cannot parse', async () => {
    answer(201, {});
    await expect(createCampaignAsDm('http://', 'p', 'c')).rejects.toThrow(/not a server address/);
    expect(endpoints.httpBase).toBe(before.httpBase);
  });
});

describe('joinAsPlayer', () => {
  it('posts the code and name, unauthenticated, and returns the player token', async () => {
    const fetchMock = answer(200, {
      identityId: 'p-1',
      campaignId: 'c1',
      sessionId: 's1',
      token: 'player-token',
    });

    const player = await joinAsPlayer('ABC234', 'Borin');

    expect(player.token).toBe('player-token');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${endpoints.httpBase}/api/join`);
    expect(init.body).toBe(JSON.stringify({ code: 'ABC234', name: 'Borin' }));
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});

describe('uploadMapFile', () => {
  it('posts the .mapbuilder text raw, with the DM token', async () => {
    const fetchMock = answer(201, { mapId: 'm1', name: 'Cragmaw', sizeBytes: 12 });

    const map = await uploadMapFile('c1', 'dm-token', '{"version":"1.0"}');

    expect(map).toEqual({ mapId: 'm1', name: 'Cragmaw', sizeBytes: 12 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${endpoints.httpBase}/api/campaigns/c1/maps`);
    expect(init.body).toBe('{"version":"1.0"}');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      Authorization: 'Bearer dm-token',
    });
  });
});

describe('errors reach the page as sentences', () => {
  it('maps the statuses a person can actually hit', async () => {
    const cases: [number, RegExp][] = [
      [401, /admin pass/i],
      [403, /will not let you in/i],
      [404, /No active game/i],
      [413, /too large/i],
    ];
    for (const [status, expected] of cases) {
      answer(status, { error: 'terse' });
      await expect(joinAsPlayer('ZZZZZZ', 'Bob')).rejects.toThrow(expected);
    }
  });

  it('falls back to the server’s own wording, then to the status', async () => {
    answer(400, { error: 'code and name are required' });
    await expect(joinAsPlayer('', '')).rejects.toThrow('code and name are required');

    answer(500, {});
    await expect(startSession('c1', 't')).rejects.toThrow('Server error 500.');
  });

  it('says the server is unreachable when the fetch itself fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(joinAsPlayer('ABC234', 'Bob')).rejects.toThrow(/Could not reach the server/);
  });
});
