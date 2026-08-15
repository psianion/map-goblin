import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../session/store';
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
      [sceneId]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env, prompts: [], log: [] },
    },
    ...(world ? { world: { clock: 720, nightSky: 'full-moon', timeSpeed: 'paused', ...world } } : {}),
  } as TriggersState;
}

const NIGHT = 1330; // 22:10

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
  useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, environment: 'outdoor' } });
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
