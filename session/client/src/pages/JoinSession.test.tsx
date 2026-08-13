import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSessionStore } from '../session/store';
import JoinSession, { prepareTableForJoin } from './JoinSession';

vi.mock('../session/auth', () => ({
  resolveInviteCode: vi.fn().mockResolvedValue({ campaignId: 'c1', sessionId: 's1' }),
  joinAsPlayer: vi.fn(),
}));
const { joinAsPlayer } = await import('../session/auth');

// swapSceneMap's own fetch/texture path is covered in loadSceneMap.test.ts — what matters
// here is only *that* the join flow calls it, and never lets it block navigation.
vi.mock('../session/loadSceneMap', () => ({ prefetchSceneMap: vi.fn() }));
const { prefetchSceneMap } = await import('../session/loadSceneMap');

const connect = vi.fn();

beforeEach(() => {
  cleanup();
  vi.mocked(joinAsPlayer).mockReset();
  vi.mocked(prefetchSceneMap).mockReset().mockResolvedValue(undefined);
  connect.mockReset();
  // A snapshot with no active scene, already landed — the join flow's default so a real
  // `prepareTableForJoin` (component tests below don't mock it out) never eats its 5s
  // snapshot-wait. Tests of the prefetch path itself set `session` to whatever they need.
  useSessionStore.setState({ connect, session: { activeSceneId: null, scenes: [] } as never });
  window.history.pushState(null, '', '/join/ABC234');
});

describe('JoinSession', () => {
  it('takes a linked code and a name to the table', async () => {
    vi.mocked(joinAsPlayer).mockResolvedValue({
      identityId: 'p-1',
      campaignId: 'c1',
      sessionId: 's1',
      token: 'player-token',
    });
    render(<JoinSession code="abc234" />);

    // The link's code is pre-filled, upper-cased, and checked against the server.
    expect(screen.getByLabelText<HTMLInputElement>('Invite code').value).toBe('ABC234');
    await screen.findByText(/Table found/);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Borin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith('player-token'));
    expect(joinAsPlayer).toHaveBeenCalledWith('ABC234', 'Borin');
    expect(window.location.pathname).toBe('/table');
  });

  it('shows why the join failed and stays put', async () => {
    vi.mocked(joinAsPlayer).mockRejectedValue(new Error('No active game for that code.'));
    render(<JoinSession code="ABC234" />);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Borin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect((await screen.findByRole('alert')).textContent).toBe('No active game for that code.');
    expect(connect).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/join/ABC234');
  });
});

describe('prepareTableForJoin', () => {
  const opts = { snapshotTimeoutMs: 20, capMs: 200 };

  it('skips the prefetch when the snapshot never arrives', async () => {
    useSessionStore.setState({ session: null });
    await prepareTableForJoin('tok', opts);
    expect(prefetchSceneMap).not.toHaveBeenCalled();
  });

  it('skips the prefetch when the table has no active scene', async () => {
    useSessionStore.setState({ session: { activeSceneId: null, scenes: [] } as never });
    await prepareTableForJoin('tok', opts);
    expect(prefetchSceneMap).not.toHaveBeenCalled();
  });

  it('resolves the active scene’s map and prefetches it', async () => {
    useSessionStore.setState({
      session: { activeSceneId: 's1', scenes: [{ id: 's1', mapId: 'm1' }] } as never,
    });
    await prepareTableForJoin('tok', opts);
    expect(prefetchSceneMap).toHaveBeenCalledWith('s1', 'm1', 'tok');
  });

  it('never rejects when the prefetch itself fails', async () => {
    useSessionStore.setState({
      session: { activeSceneId: 's1', scenes: [{ id: 's1', mapId: 'm1' }] } as never,
    });
    vi.mocked(prefetchSceneMap).mockRejectedValue(new Error('cdn unreachable'));
    await expect(prepareTableForJoin('tok', opts)).resolves.toBeUndefined();
  });

  it('gives up at the cap rather than waiting out a hung prefetch', async () => {
    useSessionStore.setState({
      session: { activeSceneId: 's1', scenes: [{ id: 's1', mapId: 'm1' }] } as never,
    });
    vi.mocked(prefetchSceneMap).mockReturnValue(new Promise(() => {})); // never settles
    const start = Date.now();
    await prepareTableForJoin('tok', { snapshotTimeoutMs: 20, capMs: 50 });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
