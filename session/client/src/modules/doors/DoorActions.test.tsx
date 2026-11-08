import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { DoorActions } from './DoorActions';

afterEach(cleanup);

// Goblin Warren's first two doors are archways ("Low Passage", "Mouth Passage"): the server
// refuses toggle and lock on them without a word, so the strip must not offer either.
const door = (style: string) => ({ id: `door-${style}`, name: style, position: [1, 1], isSecret: false, style }) as unknown as DoorChild;

function seatDm(): { action: string }[] {
  const sent: { action: string }[] = [];
  useSessionStore.setState({
    you: { identityId: 'd', name: 'Dana', role: 'dm', connected: true },
    client: { send: (m: { action: string }) => sent.push(m) } as unknown as WebSocketClient,
  });
  return sent;
}

describe('DoorActions', () => {
  it('offers an archway neither Close nor Lock, and says why', () => {
    seatDm();
    render(<DoorActions entry={{ door: door('archway'), live: { open: true, locked: false, revealed: true } }} />);
    expect(screen.queryByTestId('door-toggle')).toBeNull();
    expect(screen.queryByTestId('door-lock')).toBeNull();
    expect(screen.getByTestId('door-archway').textContent).toBe('Archway, always open');
  });

  it('locks an open door as it stands (no close needed)', () => {
    const sent = seatDm();
    render(<DoorActions entry={{ door: door('single'), live: { open: true, locked: false, revealed: true } }} />);
    fireEvent.click(screen.getByTestId('door-lock'));
    expect(sent.map((m) => m.action)).toEqual(['lock']);
  });
});
