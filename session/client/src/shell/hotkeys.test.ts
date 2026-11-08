import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../session/WebSocketClient';
import { useDoorSelection } from '../modules/doors/selection';
import { useTokenInteraction } from '../modules/tokens/drag';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { useFogBrush } from '../modules/fog/brush';
import { closeSheet, openSheet, openSheetNow } from './sheets/registry';
import { useTableShell } from './tableShell';
import { keyClaims, useHotkeys } from './hotkeys';
import './dock/tabs';
import './rail/tools';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p', name: 'Player', role: 'player', connected: true };

function session(modules: Record<string, unknown>): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: null,
    scenes: [],
    players: [],
    modules,
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}
function captureCommands(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ you: dm, session: null, client: null });
  useActiveTool.getState().setActiveTool(null);
  useTableShell.setState({ dockTab: null, lastDockTab: 'fog', card: null });
  closeSheet();
  useDoorSelection.setState({ selectedId: null, filter: '' });
  useTokenInteraction.setState({ selectedId: null, placingDefId: null, draggingId: null });
});

describe('table hotkeys', () => {
  it('picks dock tabs by number and folds on the same number', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: '2' });
    expect(useTableShell.getState().dockTab).toBe('map');
    fireEvent.keyDown(window, { key: '2' });
    expect(useTableShell.getState().dockTab).toBeNull();
  });

  it('B folds an open dock and reopens it on the last tab', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: '6' });
    fireEvent.keyDown(window, { key: 'b' });
    expect(useTableShell.getState().dockTab).toBeNull();
    fireEvent.keyDown(window, { key: 'b' });
    expect(useTableShell.getState().dockTab).toBe('world');
  });

  it('gives a player no dock keys and no DM rail tools', () => {
    useSessionStore.setState({ you: player });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: '1' });
    expect(useTableShell.getState().dockTab).toBeNull();
    fireEvent.keyDown(window, { key: 't' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    fireEvent.keyDown(window, { key: 'm' });
    expect(useActiveTool.getState().activeTool).toBe('measure');
  });

  it('arms rail tools by letter, and the same letter puts the tool down', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'p' });
    expect(useActiveTool.getState().activeTool).toBe('ping');
    fireEvent.keyDown(window, { key: 'p' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    fireEvent.keyDown(window, { key: 'd' });
    expect(useActiveTool.getState().activeTool).toBe('draw');
    fireEvent.keyDown(window, { key: 'v' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('runs the Esc ladder one step per press: tool, card, sheet, dock body, selection', () => {
    renderHook(() => useHotkeys());
    useActiveTool.getState().setActiveTool('pin');
    useTokenInteraction.setState({ selectedId: 't1' });
    useTableShell.getState().pickDockTab('fog');
    openSheet('shortcuts');
    useTableShell.getState().openCard('door:1');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(useTableShell.getState().card).toBe('door:1');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTableShell.getState().card).toBeNull();
    expect(openSheetNow()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(openSheetNow()).toBeNull();
    expect(useTableShell.getState().dockTab).toBe('fog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTableShell.getState().dockTab).toBeNull();
    expect(useTokenInteraction.getState().selectedId).toBe('t1');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTokenInteraction.getState().selectedId).toBeNull();
  });

  it('Esc with the fog rectangle armed and the Fog tab open disarms and keeps the dock open', () => {
    renderHook(() => useHotkeys());
    useTableShell.getState().pickDockTab('fog');
    fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    // Rect needs a vision scene with cell memory; arm the tool the way it would be armed.
    useActiveTool.getState().setActiveTool('fog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(useTableShell.getState().dockTab).toBe('fog');
  });

  it('? opens and closes the shortcuts sheet', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(openSheetNow()?.id).toBe('shortcuts');
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(openSheetNow()).toBeNull();
  });

  it('N and Shift+N step the turn only while combat runs', () => {
    const sent = captureCommands();
    renderHook(() => useHotkeys());
    useSessionStore.setState({ session: session({ initiative: { status: 'gathering' } }) });
    fireEvent.keyDown(window, { key: 'n' });
    expect(sent).toHaveLength(0);
    useSessionStore.setState({ session: session({ initiative: { status: 'running' } }) });
    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: 'N', shiftKey: true });
    expect(sent.map((m) => m.action)).toEqual(['next', 'previous']);
  });

  it('Shift+P pauses through the table module once the server has one', () => {
    const sent = captureCommands();
    renderHook(() => useHotkeys());
    useSessionStore.setState({ session: session({}) });
    fireEvent.keyDown(window, { key: 'P', shiftKey: true });
    expect(sent).toHaveLength(0);
    useSessionStore.setState({ session: session({ table: { paused: false } }) });
    fireEvent.keyDown(window, { key: 'P', shiftKey: true });
    expect(sent[0]).toMatchObject({ module: 'table', action: 'pause', payload: { on: true } });
  });

  it('Shift+R on a rooms-mode scene switches it to Vision and arms the rectangle', () => {
    const sent = captureCommands();
    const square = (x: number) => [[x, 0], [x + 4, 0], [x + 4, 4], [x, 4]];
    useSessionStore.setState({
      mapData: { frame: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, layers: [{ id: 'L', type: 'dungeon', children: [], rooms: [{ id: 'r1', name: 'Hall', boundary: square(0) }] }] },
      session: { ...session({ fog: { byScene: { s: { rooms: {}, concealBehindDoors: true } } } }), activeSceneId: 's' },
    });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    expect(sent.at(-1)).toMatchObject({ module: 'fog', action: 'set-mode', payload: { mode: 'vision' } });
    expect(useActiveTool.getState().activeTool).toBeNull();
    useSessionStore.setState({
      session: { ...session({ fog: { byScene: { s: { rooms: {}, concealBehindDoors: true, mode: 'vision' } } } }), activeSceneId: 's' },
    });
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useFogBrush.getState()).toMatchObject({ on: true, shape: 'box' });
  });

  it('R arms the fog reveal for the DM', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'r' });
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Reveal' });
  });

  it('leaves keys alone while typing', () => {
    renderHook(() => useHotkeys());
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '1' });
    expect(useTableShell.getState().dockTab).toBeNull();
    input.remove();
  });

  it('has no key claimed twice for either role', () => {
    for (const role of ['dm', 'player'] as const) {
      const doubles = [...keyClaims(role)].filter(([, by]) => by.length > 1);
      expect(doubles).toEqual([]);
    }
  });
});
