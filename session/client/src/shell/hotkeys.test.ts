import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../session/WebSocketClient';
import { useDoorSelection } from '../modules/doors/selection';
import { useTokenInteraction } from '../modules/tokens/drag';
import { registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { useShell } from './shellStore';
import { keyClaims, useHotkeys } from './hotkeys';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p', name: 'Player', role: 'player', connected: true };
const stub = () => null;

function sessionWithInitiative(status: 'gathering' | 'running'): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: null,
    scenes: [],
    players: [],
    modules: { initiative: { status, sceneId: null, round: 1, turn: 0, entries: [], log: [] } },
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
  useShell.setState({ openPanel: null, drawerOpen: false, diagnostics: false, sidebarOpen: false });
  Reflect.deleteProperty(window, 'matchMedia');
  useSessionStore.setState({ you: dm });
  useActiveTool.getState().setActiveTool(null);
  useDoorSelection.setState({ selectedId: null, filter: '' });
  useTokenInteraction.setState({ selectedId: null, placingDefId: null, draggingId: null });
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

  // table-shell-redesign D1/D4: G is freed from the retired triggers popover for the sidebar.
  it('G toggles the sidebar, for either role', () => {
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'g' });
    expect(useShell.getState().sidebarOpen).toBe(true);
    fireEvent.keyDown(window, { key: 'g' });
    expect(useShell.getState().sidebarOpen).toBe(false);

    useSessionStore.setState({ you: player });
    fireEvent.keyDown(window, { key: 'g' });
    expect(useShell.getState().sidebarOpen).toBe(true);
  });

  // table-shell-redesign D1: Esc closes the sidebar only in overlay mode (narrow viewport),
  // where it floats over the map behind a scrim like a modal — and only after the popover.
  it('Esc closes an overlay-mode sidebar, right after the popover and before the drawer', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }),
    });
    useShell.setState({ openPanel: 'hk-panel', drawerOpen: true, sidebarOpen: true });
    renderHook(() => useHotkeys());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().openPanel).toBeNull();
    expect(useShell.getState().sidebarOpen).toBe(true);
    expect(useShell.getState().drawerOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().sidebarOpen).toBe(false);
    expect(useShell.getState().drawerOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().drawerOpen).toBe(false);
  });

  it('Esc leaves an inset-mode (wide viewport) sidebar open — it is not modal there', () => {
    useShell.setState({ sidebarOpen: true, drawerOpen: false });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().sidebarOpen).toBe(true);
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

  // M3 review finding 18: the drawer sits between the popover and the on-map selections.
  it('Esc closes the drawer straight away when no popover is open', () => {
    useShell.setState({ drawerOpen: true });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().drawerOpen).toBe(false);
  });

  it('Esc order: popover, then the drawer, then a door selection, then a token selection, then the tool', () => {
    useActiveTool.getState().setActiveTool('fog');
    useDoorSelection.setState({ selectedId: 'd1' });
    useTokenInteraction.setState({ selectedId: 't1' });
    useShell.setState({ openPanel: 'hk-panel', drawerOpen: true });
    renderHook(() => useHotkeys());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().openPanel).toBeNull();
    expect(useShell.getState().drawerOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().drawerOpen).toBe(false);
    expect(useDoorSelection.getState().selectedId).toBe('d1');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDoorSelection.getState().selectedId).toBeNull();
    expect(useTokenInteraction.getState().selectedId).toBe('t1');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTokenInteraction.getState().selectedId).toBeNull();
    expect(useActiveTool.getState().activeTool).toBe('fog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('Esc order: popover, then a door selection, then a token selection, then the tool — one thing per press', () => {
    useActiveTool.getState().setActiveTool('fog');
    useDoorSelection.setState({ selectedId: 'd1' });
    useTokenInteraction.setState({ selectedId: 't1' });
    useShell.setState({ openPanel: 'hk-panel' });
    renderHook(() => useHotkeys());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().openPanel).toBeNull();
    expect(useDoorSelection.getState().selectedId).toBe('d1');
    expect(useTokenInteraction.getState().selectedId).toBe('t1');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDoorSelection.getState().selectedId).toBeNull();
    expect(useTokenInteraction.getState().selectedId).toBe('t1');
    expect(useActiveTool.getState().activeTool).toBe('fog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTokenInteraction.getState().selectedId).toBeNull();
    expect(useActiveTool.getState().activeTool).toBe('fog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('Esc clears a token selection straight away when no door is selected', () => {
    useTokenInteraction.setState({ selectedId: 't1' });
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTokenInteraction.getState().selectedId).toBeNull();
  });

  it('N sends next-turn for the DM once the order is locked, and does nothing before it', () => {
    useSessionStore.setState({ session: sessionWithInitiative('gathering') });
    const sent = captureCommands();
    renderHook(() => useHotkeys());

    fireEvent.keyDown(window, { key: 'n' });
    expect(sent).toHaveLength(0);

    useSessionStore.setState({ session: sessionWithInitiative('running') });
    fireEvent.keyDown(window, { key: 'n' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'initiative', action: 'next', payload: {} });
  });

  it('N does nothing for a player, running or not', () => {
    useSessionStore.setState({ you: player, session: sessionWithInitiative('running') });
    const sent = captureCommands();
    renderHook(() => useHotkeys());
    fireEvent.keyDown(window, { key: 'n' });
    expect(sent).toHaveLength(0);
  });

  describe('"/" focuses whichever composer is on screen (M3 review finding 2)', () => {
    function stubComposer(hostTestId: string): HTMLInputElement {
      const host = document.createElement('div');
      host.setAttribute('data-testid', hostTestId);
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'manual-roll');
      input.focus = vi.fn();
      host.appendChild(input);
      document.body.appendChild(host);
      return input;
    }

    it('focuses the drawer composer straight away when the drawer is already open, for either role', () => {
      useShell.setState({ drawerOpen: true });
      const input = stubComposer('log-drawer');
      renderHook(() => useHotkeys());

      fireEvent.keyDown(window, { key: '/' });
      expect(input.focus).toHaveBeenCalled();

      document.body.removeChild(input.closest('[data-testid="log-drawer"]')!);
    });

    it('focuses the roll bar directly for a player when the drawer is closed', () => {
      useSessionStore.setState({ you: player });
      const input = stubComposer('roll-bar');
      renderHook(() => useHotkeys());

      fireEvent.keyDown(window, { key: '/' });
      expect(input.focus).toHaveBeenCalled();
      expect(useShell.getState().drawerOpen).toBe(false);

      document.body.removeChild(input.closest('[data-testid="roll-bar"]')!);
    });

    it('opens the drawer and focuses its composer for the DM, once it has rendered', async () => {
      useSessionStore.setState({ you: dm });
      const input = stubComposer('log-drawer');
      renderHook(() => useHotkeys());

      fireEvent.keyDown(window, { key: '/' });
      expect(useShell.getState().drawerOpen).toBe(true);
      expect(input.focus).not.toHaveBeenCalled(); // not yet — the drawer's own render lands next frame

      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(input.focus).toHaveBeenCalled();

      document.body.removeChild(input.closest('[data-testid="log-drawer"]')!);
    });
  });

  // The Lights panel silently ate the Log's `L` for a whole release: two claims, first one
  // wins, no complaint anywhere. `useHotkeys` shouts about that in dev now; this covers the
  // reading it shouts from.
  describe('key claims', () => {
    it('lists one claimant per key when the registry is clean', () => {
      const claims = keyClaims('dm');
      expect(claims.get('k')).toEqual(['panel:hk-panel']);
      expect(claims.get('l')).toEqual(['panel:hk-log']);
      expect([...claims.values()].every((by) => by.length === 1)).toBe(true);
    });

    it('names both claimants when a panel squats a key another already has', () => {
      registerPanel({
        id: 'hk-squatter',
        title: 'Squatter',
        icon: 'fog',
        key: 'L',
        group: 'play',
        order: 0, // sorts ahead of hk-log, so hk-log's own L would never run
        roles: ['dm'],
        component: stub,
      });
      expect(keyClaims('dm').get('l')).toEqual(['panel:hk-squatter', 'panel:hk-log']);
      expect(keyClaims('player').get('l')).toEqual(['panel:hk-log']); // not this role's problem
    });

    it('catches a panel squatting one of the shell own fixed keys', () => {
      registerPanel({
        id: 'hk-g',
        title: 'G',
        icon: 'fog',
        key: 'G', // the sidebar toggle — a fixed binding, resolved before any panel
        group: 'play',
        order: 3,
        roles: ['dm'],
        component: stub,
      });
      expect(keyClaims('dm').get('g')).toEqual(['shell:g', 'panel:hk-g']);
    });
  });
});
