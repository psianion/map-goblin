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
import { keyClaims, stepName, useHotkeys } from './hotkeys';
import { shortcutTable } from './shortcutTable';
import { useToasts } from '../session/toasts';
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

const fogOnScene = (): SessionState => ({
  ...session({ fog: { byScene: { s: { on: true } } } }),
  activeSceneId: 's',
});

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

  it('Esc with the fog brush armed and the Fog tab open disarms and keeps the dock open', () => {
    useSessionStore.setState({ session: fogOnScene() });
    renderHook(() => useHotkeys());
    useTableShell.getState().pickDockTab('fog');
    fireEvent.keyDown(window, { key: 'w' });
    expect(useActiveTool.getState().activeTool).toBe('fog');
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

  it('W arms the Clear brush and Shift+W the Fog brush, and the same key puts it down', () => {
    useSessionStore.setState({ session: fogOnScene() });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'w' });
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Clear' });
    expect(useFogBrush.getState().op).toBe('clear');
    fireEvent.keyDown(window, { key: 'W', shiftKey: true });
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Fog' });
    expect(useFogBrush.getState().op).toBe('fog');
    fireEvent.keyDown(window, { key: 'W', shiftKey: true });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('W does nothing while fog is off, and R and H are free', () => {
    useSessionStore.setState({ session: { ...session({ fog: { byScene: { s: {} } } }), activeSceneId: 's' } });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'w' });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'h' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(keyClaims('dm').has('r')).toBe(false);
    expect(keyClaims('dm').has('shift+r')).toBe(false);
  });

  it('leaves keys alone while typing', () => {
    renderHook(() => useHotkeys());
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '1' });
    expect(useTableShell.getState().dockTab).toBeNull();
    input.remove();
  });

  // F26: typing digits in the New token form switched dock tabs. The guard only knew text
  // fields, and focus in that form is as often on its selects and buttons (Size, Kind, Upload
  // art) after a click; a digit there went to the dock.
  it('leaves number keys alone while focus is anywhere in an open sheet', () => {
    renderHook(() => useHotkeys());
    const sheet = document.createElement('div');
    sheet.setAttribute('data-sheet', '');
    const size = document.createElement('button');
    sheet.appendChild(size);
    document.body.appendChild(sheet);
    fireEvent.keyDown(size, { key: '2' });
    expect(useTableShell.getState().dockTab).toBeNull();
    sheet.remove();
  });

  // A popover (the scene switcher, the Invite card) is a `role="dialog"` but not a sheet: a
  // digit with focus left inside one still switches the dock.
  it('switches the dock on a number key with focus in a popover', () => {
    renderHook(() => useHotkeys());
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    const scene = document.createElement('button');
    popover.appendChild(scene);
    document.body.appendChild(popover);
    fireEvent.keyDown(scene, { key: '1' });
    expect(useTableShell.getState().dockTab).toBe('fog');
    popover.remove();
  });

  it('Ctrl or Cmd+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, an undo toasts with Redo and a redo with Undo', () => {
    const sent = captureCommands();
    renderHook(() => useHotkeys());
    const step = { module: 'tokens', action: 'move' };
    useSessionStore.setState({ history: { undo: null, redo: null } });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(sent).toHaveLength(0); // nothing to undo

    useSessionStore.setState({ history: { undo: step, redo: step } });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(sent).toEqual([
      { type: 'history', op: 'undo' },
      { type: 'history', op: 'undo' },
      { type: 'history', op: 'redo' },
      { type: 'history', op: 'redo' },
    ]);
    const redid = useToasts.getState().toast!;
    expect(redid.message).toBe('Redid token move');
    redid.action!.onAction();
    expect(sent.at(-1)).toEqual({ type: 'history', op: 'undo' });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    const undid = useToasts.getState().toast!;
    expect(undid.message).toBe('Undid token move');
    undid.action!.onAction();
    expect(sent.at(-1)).toEqual({ type: 'history', op: 'redo' });
  });

  it('leaves undo to a field being typed in, and gives a player none', () => {
    const sent = captureCommands();
    renderHook(() => useHotkeys());
    useSessionStore.setState({ history: { undo: { module: 'fog', action: 'region-set' }, redo: null } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    input.remove();
    useSessionStore.setState({ you: player });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(sent).toEqual([]);
  });

  it('names a step from the table, else by its module, else plainly', () => {
    expect(stepName({ module: 'doors', action: 'toggle' })).toBe('door');
    expect(stepName({ module: 'pins', action: 'add' })).toBe('pin change');
    expect(stepName({ module: 'elsewhere', action: 'x' })).toBe('last change');
    expect(shortcutTable('dm', false).find((s) => s.title === 'Undo')?.rows.map((r) => r.keys)).toEqual([['Ctrl+Z'], ['Ctrl+Shift+Z', 'Ctrl+Y']]);
    expect(shortcutTable('dm', true).find((s) => s.title === 'Undo')?.rows.map((r) => r.keys)).toEqual([['⌘Z'], ['⇧⌘Z']]);
    expect(shortcutTable('player').find((s) => s.title === 'Undo')).toBeUndefined();
  });

  it('has no key claimed twice for either role', () => {
    for (const role of ['dm', 'player'] as const) {
      const doubles = [...keyClaims(role)].filter(([, by]) => by.length > 1);
      expect(doubles).toEqual([]);
    }
  });
});
