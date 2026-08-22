import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { TurnPill } from './TurnPill';

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

function mkToken(id: string, over: Partial<Token> = {}): Token {
  return {
    id,
    name: id,
    imageAssetId: null,
    size: 'medium',
    disposition: 'friendly',
    sight: null,
    light: null,
    defId: null,
    x: 1,
    y: 2,
    elevation: 0,
    z: 0,
    hidden: false,
    ownerId: null,
    ...over,
  };
}

const tokensState = (byId: Record<string, Token>): TokensState => ({
  library: {},
  byScene: { 'sc-1': byId },
});

function initiative(over: Partial<InitiativeState> = {}): InitiativeState {
  return {
    status: 'running',
    sceneId: 'sc-1',
    round: 3,
    turn: 0,
    entries: [
      { key: 'e1', name: 'Marra', kind: 'npc', tokenId: 'm', initiative: 18 },
      { key: 'e2', name: 'Karlach', kind: 'pc', identityId: 'me', initiative: 14 },
      { key: 'e3', name: 'Goblin', kind: 'npc', initiative: 5 },
    ],
    log: [],
    ...over,
  };
}

beforeEach(() => {
  useSessionStore.setState({ session: null, presence: [], mapData: null, you: null });
  useShell.setState({ openPanel: null });
});
afterEach(() => cleanup());

describe('TurnPill', () => {
  it('renders nothing with no encounter running', () => {
    useSessionStore.setState({ session: session({}) });
    render(<TurnPill />);
    expect(screen.queryByTestId('turn-pill')).toBeNull();
  });

  it('renders nothing when the running encounter is on a different scene', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ initiative: initiative({ sceneId: 'other' }) }),
    });
    render(<TurnPill />);
    expect(screen.queryByTestId('turn-pill')).toBeNull();
  });

  it('names whoever is up, in primary ink, when it is not your turn', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ initiative: initiative() }),
    });
    render(<TurnPill />);
    const pill = screen.getByTestId('turn-pill');
    expect(pill.textContent).toContain("Marra's turn");
    expect(pill.querySelector('b')!.className).not.toContain('text-accent-active');
  });

  it("says you're up next when your identity is the next entry", () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ initiative: initiative({ turn: 0 }) }),
    });
    render(<TurnPill />);
    expect(screen.getByTestId('turn-pill').textContent).toContain("you're up next · round 3");
  });

  it('reads "Your turn" in accent ink when the current entry is your identity', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ initiative: initiative({ turn: 1 }) }),
    });
    render(<TurnPill />);
    const pill = screen.getByTestId('turn-pill');
    expect(pill.textContent).toContain('Your turn');
    expect(pill.querySelector('b')!.className).toContain('text-accent-active');
    // Current, not next — the muted half just names the round.
    expect(pill.textContent).not.toContain('up next');
    expect(pill.textContent).toContain('round 3');
  });

  it('reads "Your turn" when the current entry has no identity but its token is yours', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({
        initiative: initiative({ turn: 0 }),
        tokens: tokensState({ m: mkToken('m', { ownerId: 'me' }) }),
      }),
    });
    render(<TurnPill />);
    expect(screen.getByTestId('turn-pill').textContent).toContain('Your turn');
  });

  it('opens the initiative popover on click', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ initiative: initiative() }),
    });
    render(<TurnPill />);
    fireEvent.click(screen.getByTestId('turn-pill'));
    expect(useShell.getState().openPanel).toBe('initiative');
  });
});
