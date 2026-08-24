import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../session/store';
import { useShell } from '../shell/shellStore';
import { useActiveTool } from '../session/tools';
import { TableStatusBar } from './TableStatusBar';

/** A single scene's worth of `SceneTriggers`, plus the campaign's world — the badge reads
 *  the scene's own weather and gate override, and the hour off the one clock. */
function triggersState(
  sceneId: string,
  env: { weather?: string; ambient?: string },
  world?: Partial<{ clock: number; nightSky: string }>,
): TriggersState {
  return {
    byScene: {
      [sceneId]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, env, prompts: [], log: [] },
    },
    ...(world ? { world: { clock: 720, nightSky: 'full-moon', timeSpeed: 'paused', ...world } } : {}),
  } as TriggersState;
}

const NIGHT = 1330; // 22:10

function session(modules: SessionState['modules'], scenes: SessionState['scenes'] = []): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'sc-1',
    scenes,
    players: [],
    modules,
  };
}

beforeEach(() => {
  cleanup();
  useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, environment: 'outdoor' } });
  useSessionStore.setState({ connection: 'closed', latencyMs: null, sessionEnded: false, you: null });
  useShell.setState({ openPanel: null, drawerOpen: false, diagnostics: false });
  useActiveTool.getState().setActiveTool(null);
});

describe('TableStatusBar env badge', () => {
  it('is hidden when the active scene has no environment set', () => {
    useSessionStore.setState({ session: session({ triggers: triggersState('sc-1', {}) }) });
    render(<TableStatusBar />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
  });

  it('is hidden with no triggers module state at all', () => {
    useSessionStore.setState({ session: session({}) });
    render(<TableStatusBar />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
  });

  // P2 — the hour is the world clock's, not a second dial: the badge mirrors what the
  // coupling resolved, and the scene's own weather rides along behind it.
  it('renders the hour, the sky, the level and the weather, world first', () => {
    useSessionStore.setState({
      session: session({
        triggers: triggersState('sc-1', { weather: 'rain' }, { clock: NIGHT, nightSky: 'crescent' }),
      }),
    });
    render(<TableStatusBar />);
    expect(screen.getByTestId('env-badge')).toHaveProperty(
      'textContent',
      'Night · Crescent · Darkness · Rain',
    );
  });

  it('stays quiet at midday on a clock nobody has taken over', () => {
    useSessionStore.setState({
      session: session({ triggers: triggersState('sc-1', {}, { clock: 720 }) }),
    });
    render(<TableStatusBar />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
  });

  it('names a DM override as one, rather than as the hour it is not', () => {
    useSessionStore.setState({
      session: session({ triggers: triggersState('sc-1', { ambient: 'darkness' }, { clock: 720 }) }),
    });
    render(<TableStatusBar />);
    expect(screen.getByTestId('env-badge')).toHaveProperty('textContent', 'Darkness (override)');
  });

  it('renders just the one field that is set', () => {
    useSessionStore.setState({ session: session({ triggers: triggersState('sc-1', { weather: 'fog' }) }) });
    render(<TableStatusBar />);
    expect(screen.getByTestId('env-badge')).toHaveProperty('textContent', 'Fog');
  });

  it('renders identically for a DM seat and a player seat — no role gating', () => {
    const player: PlayerInfo = { identityId: 'p1', name: 'Iris', role: 'player', connected: true };
    const withEnv = session({ triggers: triggersState('sc-1', {}, { clock: NIGHT }) });

    useSessionStore.setState({ you: null, session: withEnv });
    const dm = render(<TableStatusBar />);
    const dmText = dm.getByTestId('env-badge').textContent;
    dm.unmount();

    useSessionStore.setState({ you: player, session: withEnv });
    const asPlayer = render(<TableStatusBar />);
    expect(asPlayer.getByTestId('env-badge')).toHaveProperty('textContent', dmText);
  });
});

describe('TableStatusBar — M1 shell', () => {
  it('names the active scene and opens the Session popover on click', () => {
    useSessionStore.setState({
      session: session({}, [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }]),
    });
    render(<TableStatusBar />);
    const button = screen.getByTestId('scene-name');
    expect(button.textContent).toBe('Fieldstone Keep');

    fireEvent.click(button);
    expect(useShell.getState().openPanel).toBe('session');
  });

  it('falls back to a placeholder with no active scene', () => {
    useSessionStore.setState({ session: session({}) });
    render(<TableStatusBar />);
    expect(screen.getByTestId('scene-name').textContent).toBe('No scene');
  });

  it('hides FPS/frame-time by default and shows them once diagnostics is on', () => {
    useSessionStore.setState({ session: session({}) });
    render(<TableStatusBar />);
    expect(screen.queryByText(/FPS/)).toBeNull();

    cleanup();
    useShell.setState({ diagnostics: true });
    render(<TableStatusBar />);
    expect(screen.getByText(/FPS/)).not.toBeNull();
  });

  it('shows the armed tool with its exit key only while a tool is armed', () => {
    useSessionStore.setState({ session: session({}) });
    render(<TableStatusBar />);
    expect(screen.queryByTestId('active-tool')).toBeNull();

    cleanup();
    useActiveTool.getState().setActiveTool('fog');
    useSessionStore.setState({ session: session({}) });
    render(<TableStatusBar />);
    const tool = screen.getByTestId('active-tool');
    expect(tool.textContent).toContain('Fog');
    expect(tool.textContent).toContain('Esc');
  });

  it('reads connection as a shape, not a colour', () => {
    for (const [state, shape] of [
      ['open', 'disc'],
      ['connecting', 'ring'],
      ['reconnecting', 'ring'],
      ['closed', 'triangle'],
    ] as const) {
      cleanup();
      useSessionStore.setState({ connection: state, session: session({}) });
      render(<TableStatusBar />);
      expect(screen.getByTestId('connection-status').querySelector(`[data-shape="${shape}"]`)).not.toBeNull();
    }
  });
});

describe('TableStatusBar — M4 player variant', () => {
  const player: PlayerInfo = { identityId: 'p1', name: 'Iris', role: 'player', connected: true };

  it('drops latency, diagnostics and the armed tool, but keeps scene name and env badge', () => {
    useSessionStore.setState({
      you: player,
      connection: 'open',
      latencyMs: 42,
      session: session(
        { triggers: triggersState('sc-1', {}, { clock: NIGHT }) },
        [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }],
      ),
    });
    useShell.setState({ diagnostics: true });
    useActiveTool.getState().setActiveTool('fog');

    render(<TableStatusBar />);

    expect(screen.getByTestId('scene-name').textContent).toBe('Fieldstone Keep');
    expect(screen.getByTestId('env-badge')).not.toBeNull();
    expect(screen.queryByText(/ ms$/)).toBeNull();
    expect(screen.queryByText(/FPS/)).toBeNull();
    expect(screen.queryByTestId('active-tool')).toBeNull();
  });

  it('keeps the DM chrome for any non-player seat, including before the join snapshot lands', () => {
    useSessionStore.setState({ you: null, connection: 'open', latencyMs: 42, session: session({}) });
    useShell.setState({ diagnostics: true });
    render(<TableStatusBar />);
    expect(screen.getByText(/FPS/)).not.toBeNull();
    expect(screen.getByText('42 ms')).not.toBeNull();
  });
});
