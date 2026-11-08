import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({ refreshDmToken: vi.fn() }));
const { refreshDmToken } = await import('./auth');
const { forgetDmToken, freshDmToken, getDmToken, saveDmToken, storedCampaigns, tokenExp } = await import('./dmTokens');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const tokenFor = (exp: number): string => `${btoa(JSON.stringify({ role: 'dm', exp })).replace(/=+$/, '')}.sig`;
const camp = (id: string) => ({ campaignId: id, name: id, server: 'http://x' });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(refreshDmToken).mockReset();
});

describe('DM tokens', () => {
  it('reads exp off the token and keeps it under gg.table.dm.<campaign>', () => {
    saveDmToken(camp('c1'), tokenFor(NOW + DAY));
    expect(localStorage.getItem('gg.table.dm.c1')).toBe(tokenFor(NOW + DAY));
    expect(tokenExp(getDmToken('c1')!)).toBe(NOW + DAY);
    expect(tokenExp('nonsense')).toBeNull();
  });

  it('offers only campaigns whose token has not run out', () => {
    saveDmToken(camp('live'), tokenFor(NOW + DAY));
    saveDmToken(camp('spent'), tokenFor(NOW - 1));
    expect(storedCampaigns(NOW).map((c) => c.campaignId)).toEqual(['live']);
    forgetDmToken('live');
    expect(storedCampaigns(NOW)).toEqual([]);
  });

  it('refreshes a token with under a week left, and keeps it when the refresh fails', async () => {
    saveDmToken(camp('c1'), tokenFor(NOW + 2 * DAY));
    vi.mocked(refreshDmToken).mockResolvedValueOnce({ token: tokenFor(NOW + 30 * DAY), campaignId: 'c1', exp: NOW + 30 * DAY });
    expect(await freshDmToken('c1', NOW)).toBe(tokenFor(NOW + 30 * DAY));
    expect(getDmToken('c1')).toBe(tokenFor(NOW + 30 * DAY));
    saveDmToken(camp('c2'), tokenFor(NOW + DAY));
    vi.mocked(refreshDmToken).mockRejectedValueOnce(new Error('down'));
    expect(await freshDmToken('c2', NOW)).toBe(tokenFor(NOW + DAY));
  });

  it('leaves a token with weeks left alone', async () => {
    saveDmToken(camp('c1'), tokenFor(NOW + 20 * DAY));
    expect(await freshDmToken('c1', NOW)).toBe(tokenFor(NOW + 20 * DAY));
    expect(refreshDmToken).not.toHaveBeenCalled();
  });
});
