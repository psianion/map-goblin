// Board 7: Campaign → Map → Invite with Back; the server and pass step only while no DM pass is
// held; the canvas's handoff landing on the Map step; the starting room on the call that opens
// the table.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { endpoints } from '../endpoints';
import { saveDmToken } from '../session/dmTokens';
import HostSetup from './HostSetup';

vi.mock('../session/auth', () => ({
  createCampaignAsDm: vi.fn(),
  fetchActiveSession: vi.fn(),
  fetchMapDoc: vi.fn(),
  listCampaignsAsAdmin: vi.fn(),
  listScenes: vi.fn(),
  mintDmToken: vi.fn(),
  redeemHandoff: vi.fn(),
  refreshDmToken: vi.fn(),
  startSession: vi.fn(),
  uploadMapFile: vi.fn(),
}));
const auth = await import('../session/auth');

const DAY = 24 * 60 * 60 * 1000;
const tokenFor = (exp: number): string => `${btoa(JSON.stringify({ campaignId: 'c1', role: 'dm', exp })).replace(/=+$/, '')}.sig`;

const MAP = {
  version: '3.0',
  mapSettings: { name: 'Emberhold Crypt' },
  grid: {},
  layers: [{ id: 'layer-1', type: 'dungeon', rooms: [{ id: 'r-vestibule', name: 'Vestibule of Ash' }] }],
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = '';
  vi.mocked(auth.listCampaignsAsAdmin).mockReset().mockResolvedValue({ campaigns: [{ id: 'c9', name: 'Old Keep', createdAt: 0, updatedAt: 0 }] });
  vi.mocked(auth.createCampaignAsDm).mockReset().mockResolvedValue({ campaignId: 'c1', identityId: 'dm', token: tokenFor(Date.now() + 30 * DAY) });
  vi.mocked(auth.mintDmToken).mockReset().mockResolvedValue({ campaignId: 'c9', token: tokenFor(Date.now() + 30 * DAY), name: 'Old Keep' });
  vi.mocked(auth.fetchActiveSession).mockReset().mockRejectedValue(new Error('none'));
  vi.mocked(auth.listScenes).mockReset().mockResolvedValue({
    scenes: [{ id: 's1', name: 'Web Gallery', sortIndex: 0, visibleToPlayers: true, mapId: 'm1', updatedAt: Date.now() - 2 * 3600_000 }],
  });
  vi.mocked(auth.fetchMapDoc).mockReset().mockResolvedValue(MAP);
  vi.mocked(auth.startSession).mockReset().mockResolvedValue({ sessionId: 'x', campaignId: 'c1', inviteCode: 'ABC234' });
  vi.mocked(auth.redeemHandoff).mockReset();
  vi.mocked(auth.refreshDmToken).mockReset();
});

describe('HostSetup', () => {
  it('asks for the server and pass when no DM pass is held, then lists the campaigns', async () => {
    render(<HostSetup />);
    expect(screen.getByTestId('host-connect')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Admin pass'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByTestId('host-campaign')).toBeTruthy();
    expect(auth.listCampaignsAsAdmin).toHaveBeenCalledWith(endpoints.httpBase, 'pass');
    expect(screen.getByText('Old Keep')).toBeTruthy();
  });

  it('skips the pass with a held DM token, and Different DM brings it back', async () => {
    saveDmToken({ campaignId: 'c1', name: 'Cragmaw', server: endpoints.httpBase }, tokenFor(Date.now() + 20 * DAY));
    render(<HostSetup />);
    expect(screen.getByTestId('host-campaign')).toBeTruthy();
    expect(screen.queryByTestId('host-connect')).toBeNull();
    fireEvent.click(screen.getByTestId('host-different-dm'));
    expect(screen.getByTestId('host-connect')).toBeTruthy();
  });

  it('walks Campaign, Map, Invite with the starting room, and Back returns a step', async () => {
    saveDmToken({ campaignId: 'c1', name: 'Cragmaw', server: endpoints.httpBase }, tokenFor(Date.now() + 20 * DAY));
    render(<HostSetup />);
    fireEvent.click(screen.getByText('Cragmaw'));
    const card = await screen.findByTestId('library-card');
    expect(card.textContent).toContain('Published 2h ago');
    fireEvent.click(card);
    fireEvent.click(await screen.findByText('Vestibule of Ash'));
    fireEvent.click(screen.getByTestId('host-open'));
    expect(await screen.findByTestId('host-invite')).toBeTruthy();
    expect(auth.startSession).toHaveBeenCalledWith('c1', expect.any(String), { sceneId: 's1', roomId: 'r-vestibule' }, 's1');
    expect(screen.getByTestId('invite-code').textContent).toBe('ABC234');
    expect(screen.getByTestId('invite-qr')).toBeTruthy();
    fireEvent.click(screen.getByTestId('host-back'));
    expect(screen.getByTestId('host-map')).toBeTruthy();
    fireEvent.click(screen.getByTestId('host-back'));
    expect(screen.getByTestId('host-campaign')).toBeTruthy();
  });

  it('refreshes a held DM token with under a week left before using it', async () => {
    saveDmToken({ campaignId: 'c1', name: 'Cragmaw', server: endpoints.httpBase }, tokenFor(Date.now() + 2 * DAY));
    vi.mocked(auth.refreshDmToken).mockResolvedValue({ token: tokenFor(Date.now() + 30 * DAY), campaignId: 'c1', exp: Date.now() + 30 * DAY });
    render(<HostSetup />);
    fireEvent.click(screen.getByText('Cragmaw'));
    await screen.findByTestId('host-map');
    expect(auth.refreshDmToken).toHaveBeenCalledWith('c1', expect.any(String));
  });

  it('redeems a handoff from the canvas and lands on the Map step', async () => {
    window.location.hash = '#handoff=abc123';
    vi.mocked(auth.redeemHandoff).mockResolvedValue({ campaignId: 'c1', campaignName: 'Cragmaw', token: tokenFor(Date.now() + 30 * DAY) });
    render(<HostSetup />);
    expect(await screen.findByTestId('host-map')).toBeTruthy();
    expect(auth.redeemHandoff).toHaveBeenCalledWith('abc123');
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(localStorage.getItem('gg.table.dm.c1')).not.toBeNull());
  });

  it('resumes a table that is already open on the Invite step', async () => {
    saveDmToken({ campaignId: 'c1', name: 'Cragmaw', server: endpoints.httpBase }, tokenFor(Date.now() + 20 * DAY));
    vi.mocked(auth.fetchActiveSession).mockResolvedValue({ sessionId: 'x', inviteCode: 'LIVE42' });
    render(<HostSetup />);
    fireEvent.click(screen.getByText('Cragmaw'));
    expect(await screen.findByText('Your table is already open')).toBeTruthy();
    expect(screen.getByTestId('invite-code').textContent).toBe('LIVE42');
  });
});
