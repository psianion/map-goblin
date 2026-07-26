import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSessionStore } from '../session/store';
import JoinSession from './JoinSession';

vi.mock('../session/auth', () => ({
  resolveInviteCode: vi.fn().mockResolvedValue({ campaignId: 'c1', sessionId: 's1' }),
  joinAsPlayer: vi.fn(),
}));
const { joinAsPlayer } = await import('../session/auth');

const connect = vi.fn();

beforeEach(() => {
  cleanup();
  vi.mocked(joinAsPlayer).mockReset();
  connect.mockReset();
  useSessionStore.setState({ connect });
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
