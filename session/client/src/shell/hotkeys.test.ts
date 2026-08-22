import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { useShell } from './shellStore';
import { useHotkeys } from './hotkeys';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const stub = () => null;

beforeEach(() => {
  cleanup();
  registerPanel({
    id: 'hk-panel',
    title: 'HK Panel',
    icon: 'fog',
    key: 'K',
    group: 'play',
    order: 1,
    roles: ['dm', 'player'],
    component: stub,
  });
  registerPanel({
    id: 'hk-log',
    title: 'HK Log',
    icon: 'log',
    key: 'L',
    group: 'log',
    order: 2,
    roles: ['dm', 'player'],
    component: stub,
  });
  useShell.setState({ openPanel: null, drawerOpen: false, diagnostics: false });
  useSessionStore.setState({ you: dm });
  useActiveTool.getState().setActiveTool(null);
});

describe('shell hotkeys', () => {
  it('toggles a panel by its registered letter', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'k' });
    expect(useShell.getState().openPanel).toBe('hk-panel');
    fireEvent.keyDown(window, { key: 'k' });
    expect(useShell.getState().openPanel).toBeNull();
  });

  it('opens the drawer, not a popover, for a log-group panel', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'l' });
    expect(useShell.getState().drawerOpen).toBe(true);
    expect(useShell.getState().openPanel).toBeNull();
  });

  it('ignores letters while typing, same guard as the camera keys', () => {
    renderHook(() => useHotkeys());
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'k' });
    expect(useShell.getState().openPanel).toBeNull();
    document.body.removeChild(input);
  });

  it('toggles diagnostics on Shift+D, and ignores every other key held with a modifier', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(useShell.getState().openPanel).toBeNull();
    fireEvent.keyDown(window, { key: 'k', shiftKey: true });
    expect(useShell.getState().openPanel).toBeNull();

    fireEvent.keyDown(window, { key: 'D', shiftKey: true });
    expect(useShell.getState().diagnostics).toBe(true);
    fireEvent.keyDown(window, { key: 'D', shiftKey: true });
    expect(useShell.getState().diagnostics).toBe(false);
  });

  it('Esc order: closes an open popover first, only disarms the tool on the next press', () => {
    useActiveTool.getState().setActiveTool('fog');
    useShell.setState({ openPanel: 'hk-panel' });
    renderHook(() => useHotkeys());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().openPanel).toBeNull();
    expect(useActiveTool.getState().activeTool).toBe('fog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('Esc disarms the tool straight away when no popover is open', () => {
    useActiveTool.getState().setActiveTool('fog');
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });
});
