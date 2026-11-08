import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { LightCard } from './LightCard';
import { useLightSelection } from './selection';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const light = {
  id: 'l1',
  childType: 'light',
  name: 'Brazier',
  visible: true,
  intensity: 0.5,
  radius: 6,
  featherRadius: 3,
  falloff: 'linear',
  color: '#ffaa00',
  position: { x: 2, y: 2 },
};

interface Sent {
  action: string;
  payload: unknown;
}
function capture(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ you: dm, mapData: null });
  useStore.setState({ layers: [{ id: 'L', type: 'dungeon', rooms: [], children: [light] }] as never });
  useLightSelection.setState({ selectedId: 'l1' });
});

describe('LightCard', () => {
  it('turns the light off, sets falloff and resets', () => {
    const sent = capture();
    render(<LightCard />);
    fireEvent.click(screen.getAllByRole('switch', { hidden: true })[0]!);
    fireEvent.click(screen.getByText('Quadratic'));
    fireEvent.click(screen.getByTestId('light-reset'));
    expect(sent).toEqual([
      expect.objectContaining({ action: 'set-light', payload: { lightId: 'l1', patch: { visible: false } } }),
      expect.objectContaining({ action: 'set-light', payload: { lightId: 'l1', patch: { falloff: 'quadratic' } } }),
      expect.objectContaining({ action: 'reset-light', payload: { lightId: 'l1' } }),
    ]);
  });
});
