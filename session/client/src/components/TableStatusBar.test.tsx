import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../session/store';
import { TableStatusBar } from './TableStatusBar';

/** A single scene's worth of `SceneTriggers` — env is all this suite cares about. */
function triggersState(sceneId: string, env: { time?: string; weather?: string }): TriggersState {
  return {
    byScene: {
      [sceneId]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env, prompts: [], log: [] },
    },
  } as TriggersState;
}

function session(modules: SessionState['modules']): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'sc-1',
    scenes: [],
    players: [],
    modules,
  };
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ connection: 'closed', latencyMs: null, sessionEnded: false, you: null });
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

  it('renders time and weather, capitalized, time first, joined by a comma', () => {
    useSessionStore.setState({
      session: session({ triggers: triggersState('sc-1', { time: 'dusk', weather: 'rain' }) }),
    });
    render(<TableStatusBar />);
    expect(screen.getByTestId('env-badge')).toHaveProperty('textContent', 'Dusk, Rain');
  });

  it('renders just the one field that is set', () => {
    useSessionStore.setState({ session: session({ triggers: triggersState('sc-1', { weather: 'fog' }) }) });
    render(<TableStatusBar />);
    expect(screen.getByTestId('env-badge')).toHaveProperty('textContent', 'Fog');
  });

  it('renders identically for a DM seat and a player seat — no role gating', () => {
    const player: PlayerInfo = { identityId: 'p1', name: 'Iris', role: 'player', connected: true };
    const withEnv = session({ triggers: triggersState('sc-1', { time: 'day' }) });

    useSessionStore.setState({ you: null, session: withEnv });
    const dm = render(<TableStatusBar />);
    const dmText = dm.getByTestId('env-badge').textContent;
    dm.unmount();

    useSessionStore.setState({ you: player, session: withEnv });
    const asPlayer = render(<TableStatusBar />);
    expect(asPlayer.getByTestId('env-badge')).toHaveProperty('textContent', dmText);
  });
});
