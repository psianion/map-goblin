import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useTableShell } from '../tableShell';
import { PinCard } from './PinCard';
import { addPin, useLocalPins } from './pins';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

function session(modules: Record<string, unknown>): SessionState {
  return { protocolVersion: PROTOCOL_VERSION, sessionId: 's', campaignId: 'c', activeSceneId: 'a', scenes: [], players: [dm], modules };
}

interface Sent {
  module: string;
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
  useTableShell.setState({ card: null });
  useLocalPins.setState({ pins: [], pendingAt: null });
  useSessionStore.setState({ you: dm, session: session({}) });
});

describe('pins', () => {
  it('keeps pins on this seat without the pins module, and writes on one', () => {
    render(<PinCard />);
    act(() => addPin(2, 3, true));
    fireEvent.change(screen.getByTestId('pin-text'), { target: { value: 'Trap here' } });
    fireEvent.click(screen.getByTestId('pin-save'));
    expect(useLocalPins.getState().pins[0]).toMatchObject({ x: 2, y: 3, text: 'Trap here', dmOnly: true });
  });

  it('goes through the pins module when the server has it, and opens the card it hands back', () => {
    const sent = capture();
    useSessionStore.setState({ session: session({ pins: { byScene: {} } }) });
    render(<PinCard />);
    act(() => addPin(2, 3, true));
    expect(sent[0]).toMatchObject({ module: 'pins', action: 'add', payload: { x: 2, y: 3, text: '', dmOnly: true } });
    act(() => useSessionStore.setState({ session: session({ pins: { byScene: { a: [{ id: 'p9', x: 2, y: 3, text: '', dmOnly: true }] } } }) }));
    expect(useTableShell.getState().card).toBe('pin:p9');
    fireEvent.click(screen.getByTestId('pin-delete'));
    expect(sent[1]).toMatchObject({ module: 'pins', action: 'delete', payload: { id: 'p9' } });
  });
});
