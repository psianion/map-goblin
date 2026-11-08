import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { DoorCard } from './DoorCard';
import { useDoorSelection } from './selection';

const live = { open: false, locked: true, revealed: false };
vi.mock('./useLiveDoors', () => ({
  useLiveDoors: () => [{ door: { id: 'd1', name: 'Gate', position: [1, 1], isSecret: false }, live }],
}));

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

function capture(): { action: string }[] {
  const sent: { action: string }[] = [];
  useSessionStore.setState({ client: { send: (m: { action: string }) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(() => {
  cleanup();
  useDoorSelection.setState({ selectedId: null });
  useSessionStore.setState({ you: dm });
});

describe('DoorCard', () => {
  it('stays away until a door is selected', () => {
    render(<DoorCard />);
    expect(screen.queryByTestId('door-card')).toBeNull();
  });

  it('says a locked door is locked and unlocks it', () => {
    const sent = capture();
    useDoorSelection.setState({ selectedId: 'd1' });
    render(<DoorCard />);
    expect(screen.getByTestId('door-toggle').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('door-lock'));
    expect(sent.map((m) => m.action)).toEqual(['unlock']);
    fireEvent.click(screen.getByLabelText('Close Gate'));
    expect(useDoorSelection.getState().selectedId).toBeNull();
  });

  it('gives a player no door controls', () => {
    useSessionStore.setState({ you: pia });
    useDoorSelection.setState({ selectedId: 'd1' });
    render(<DoorCard />);
    expect(screen.queryByTestId('door-lock')).toBeNull();
  });
});
