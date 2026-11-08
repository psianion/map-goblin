import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';
import { attachMarkInput, LONG_PRESS_MS } from './marks/markInput';
import { useMarks } from './marks/marks';
import { PhoneBar } from './phone/PhoneBar';
import { closeSheet, openSheetNow } from './sheets/registry';
import { WaitingCard } from './WaitingCard';
import './sheets';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };
const bo: PlayerInfo = { identityId: 'p2', name: 'Bo', role: 'player', connected: false };

function session(activeSceneId: string | null): SessionState {
  return { protocolVersion: PROTOCOL_VERSION, sessionId: 's', campaignId: 'c', activeSceneId, scenes: [], players: [dm, pia, bo], modules: {} };
}

beforeEach(() => {
  cleanup();
  closeSheet();
  useMarks.setState({ marks: [] });
  useSessionStore.setState({ you: pia, session: session(null) });
});
afterEach(() => vi.useRealTimers());

describe('player shell', () => {
  it('waits for the DM with the party listed while no scene is live', () => {
    const { rerender } = render(<WaitingCard />);
    expect(screen.getByTestId('waiting-party').textContent).toContain('Pia');
    expect(screen.getByTestId('waiting-party').textContent).toContain('Bo');
    useSessionStore.setState({ session: session('a') });
    rerender(<WaitingCard />);
    expect(screen.queryByTestId('waiting-card')).toBeNull();
  });

  it('gives a phone Map, Log and Find me, and opens the Log sheet', () => {
    render(<PhoneBar />);
    fireEvent.click(screen.getByTestId('phone-tab-log'));
    expect(openSheetNow()?.id).toBe('log');
    fireEvent.click(screen.getByTestId('phone-tab-map'));
    expect(openSheetNow()).toBeNull();
    expect(screen.getByTestId('phone-find-token')).toBeTruthy();
  });

  it('has no phone bar for the DM', () => {
    useSessionStore.setState({ you: dm });
    render(<PhoneBar />);
    expect(screen.queryByTestId('phone-bar')).toBeNull();
  });

  it('pings on a long press of a touch, and not on a drag', () => {
    vi.useFakeTimers();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const engine = { canvas: () => canvas, screenToWorld: (x: number, y: number) => ({ x: x / 10, y: y / 10 }) };
    const detach = attachMarkInput(engine as unknown as RenderEngine);
    fireEvent.pointerDown(canvas, { button: 0, pointerType: 'touch', clientX: 50, clientY: 50 });
    fireEvent.pointerMove(canvas, { pointerType: 'touch', clientX: 90, clientY: 50 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(useMarks.getState().marks).toEqual([]);
    fireEvent.pointerDown(canvas, { button: 0, pointerType: 'touch', clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(useMarks.getState().marks[0]?.msg).toEqual({ kind: 'ping', x: 5, y: 5 });
    detach();
    canvas.remove();
  });
});
