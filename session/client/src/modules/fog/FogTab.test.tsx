import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import { fillRegion, regionOf, setCells } from '@dnd/mechanics/fog';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { useToasts } from '../../session/toasts';
import { useFogBrush } from './brush';
import { FogBody } from './FogTab';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const FRAME = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function session(fog: unknown): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'Web Gallery', mapId: 'm' }],
    players: [dm],
    modules: { fog: { byScene: { a: fog } } },
  };
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

const fogged = (over: object = {}) => session({ on: true, ...over });

beforeEach(() => {
  cleanup();
  useActiveTool.getState().setActiveTool(null);
  useFogBrush.setState({ op: 'clear', size: 3 });
  useToasts.setState({ toast: null });
  // An imported picture: no floors, so the whole frame is ground.
  useStore.setState({ layers: [], levels: [{ id: 'level-1', name: 'Ground' }] } as never);
  useSessionStore.setState({ you: dm, mapData: { frame: FRAME, layers: [] }, session: session({}) });
});

describe('Fog tab', () => {
  it('shows only the Fog card and one line while fog is off', () => {
    render(<FogBody />);
    expect(screen.getByTestId('fog-body').getAttribute('data-fog')).toBe('off');
    expect(screen.getByTestId('fog-switch').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Nothing is hidden')).toBeTruthy();
    expect(screen.getByText('Turn fog on to cover the map.')).toBeTruthy();
    expect(screen.queryByTestId('fog-brush-clear')).toBeNull();
    expect(screen.queryByTestId('fog-auto-explore')).toBeNull();
  });

  it('turns fog on from the card and arms the Clear brush', () => {
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-switch'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'set-on', payload: { on: true } });
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Clear' });
    expect(useFogBrush.getState().op).toBe('clear');
  });

  it('shows each card on with the ink ring, a filled chip and a different icon', () => {
    useSessionStore.setState({ session: fogged({ autoExplore: false }) });
    const { rerender } = render(<FogBody />);
    const sw = screen.getByTestId('fog-switch');
    expect(sw.getAttribute('aria-pressed')).toBe('true');
    expect(sw.className).toContain('ring-ink');
    expect(screen.getByTestId('fog-switch-icon').className).toContain('bg-ink');
    expect(screen.getByTestId('fog-switch-icon').getAttribute('data-icon')).toBe('Cloud');

    const auto = screen.getByTestId('fog-auto-explore');
    expect(auto.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('fog-auto-explore-icon').className).toContain('bg-bg');
    const offIcon = screen.getByTestId('fog-auto-explore-icon').getAttribute('data-icon');
    useSessionStore.setState({ session: fogged() });
    rerender(<FogBody />);
    expect(screen.getByTestId('fog-auto-explore').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('fog-auto-explore-icon').getAttribute('data-icon')).not.toBe(offIcon);
    expect(screen.getByText('Tokens clear what they see')).toBeTruthy();
  });

  it('sends each card its command', () => {
    useSessionStore.setState({ session: fogged() });
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-auto-explore'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-auto-explore', payload: { autoExplore: false } });

    fireEvent.click(screen.getByTestId('fog-brush-fog'));
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Fog' });
    expect(screen.getByTestId('fog-brush-fog').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('fog-brush-clear').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('fog-brush-clear'));
    expect(useFogBrush.getState().op).toBe('clear');
    // The armed brush's own card puts it down.
    fireEvent.click(screen.getByTestId('fog-brush-clear'));
    expect(useActiveTool.getState().activeTool).toBeNull();

    // Turning fog off puts an armed brush down with it.
    fireEvent.click(screen.getByTestId('fog-brush-clear'));
    fireEvent.click(screen.getByTestId('fog-switch'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-on', payload: { on: false } });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('reads the share of the ground still fogged', () => {
    useSessionStore.setState({ session: fogged() });
    const { rerender } = render(<FogBody />);
    expect(screen.getByText('100% of the map')).toBeTruthy();
    const top: [number, number][] = [];
    for (let row = 0; row < 5; row++) for (let col = 0; col < 10; col++) top.push([col, row]);
    useSessionStore.setState({ session: fogged({ cleared: { 'level-1': setCells(regionOf(FRAME)!, top) } }) });
    rerender(<FogBody />);
    expect(screen.getByText('50% of the map')).toBeTruthy();
    useSessionStore.setState({ session: fogged({ cleared: { 'level-1': fillRegion(regionOf(FRAME)!) } }) });
    rerender(<FogBody />);
    expect(screen.getByText('0% of the map')).toBeTruthy();
  });

  it('offers Undo after Clear all and Fog all, which restores the record from before', () => {
    const before = { 'level-1': fillRegion(regionOf(FRAME)!) };
    useSessionStore.setState({ session: fogged({ cleared: before }) });
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-fog-all'));
    expect(sent.at(-1)).toMatchObject({ module: 'fog', action: 'fog-all', payload: {} });
    const toast = useToasts.getState().toast!;
    expect(toast.action?.label).toBe('Undo');
    toast.action!.onAction();
    expect(sent.at(-1)).toMatchObject({ module: 'fog', action: 'restore', payload: { cleared: before } });

    fireEvent.click(screen.getByTestId('fog-clear-all'));
    expect(sent.at(-1)).toMatchObject({ action: 'clear-all' });
    useToasts.getState().toast!.action!.onAction();
    expect(sent.at(-1)).toMatchObject({ module: 'fog', action: 'restore', payload: { cleared: before } });
  });
});
