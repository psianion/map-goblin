import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';

vi.mock('../renderer/camera', () => ({ frameWorldPoint: vi.fn() }));
import { frameWorldPoint } from '../renderer/camera';
import { PartyStrip } from './PartyStrip';

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

beforeEach(() => {
  useSessionStore.setState({ session: null, presence: [], mapData: null, you: null });
  useShell.setState({ sidebarOpen: false });
  vi.mocked(frameWorldPoint).mockClear();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('PartyStrip — idle', () => {
  it('renders nothing with no tokens on the scene', () => {
    useSessionStore.setState({ session: session({ tokens: tokensState({}) }) });
    render(<PartyStrip />);
    expect(screen.queryByTestId('party-strip')).toBeNull();
  });

  it('shows claimed tokens first, then friendly unclaimed, capped at 8 with a +N chip', () => {
    const byId: Record<string, Token> = {};
    for (let i = 0; i < 5; i++) {
      byId[`claim-${i}`] = mkToken(`claim-${i}`, { ownerId: `player-${i}` });
    }
    for (let i = 0; i < 5; i++) {
      byId[`free-${i}`] = mkToken(`free-${i}`, { disposition: 'friendly' });
    }
    // Never shown: an unclaimed hostile token is not the party.
    byId['foe'] = mkToken('foe', { disposition: 'hostile' });

    useSessionStore.setState({ session: session({ tokens: tokensState(byId) }) });
    render(<PartyStrip />);

    for (let i = 0; i < 5; i++) expect(screen.getByTestId(`party-disc-claim-${i}`)).toBeTruthy();
    expect(screen.getByTestId('party-disc-free-0')).toBeTruthy();
    expect(screen.getByTestId('party-disc-free-1')).toBeTruthy();
    expect(screen.getByTestId('party-disc-free-2')).toBeTruthy();
    expect(screen.queryByTestId('party-disc-free-3')).toBeNull();
    expect(screen.queryByTestId('party-disc-foe')).toBeNull();
    expect(screen.getByTestId('party-disc-overflow').textContent).toContain('+2');
  });

  // table-shell-redesign D1/D5: clears the sidebar's edge toggle even when closed, and insets
  // further once an inset-mode sidebar is open (never an overlay-mode one).
  it('reserves room for the sidebar edge toggle, and insets when the sidebar is open', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ w: mkToken('w') }) }),
    });
    render(<PartyStrip />);
    expect(screen.getByTestId('party-strip').className).toContain('left-[52px]');

    cleanup();
    useShell.setState({ sidebarOpen: true });
    render(<PartyStrip />);
    expect(screen.getByTestId('party-strip').className).toContain('left-[352px]');
  });

  it('falls back to initials when a token has no portrait', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ w: mkToken('w', { name: 'Willow Ashgrove' }) }) }),
    });
    render(<PartyStrip />);
    expect(screen.getByTestId('party-disc-w').textContent).toBe('WA');
  });

  it('frames the token on click', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ w: mkToken('w', { x: 4, y: 6 }) }) }),
    });
    render(<PartyStrip />);
    fireEvent.click(screen.getByTestId('party-disc-w'));
    expect(frameWorldPoint).toHaveBeenCalledWith(4.5, 6.5);
  });
});

describe('PartyStrip — encounter', () => {
  function initiative(over: Partial<InitiativeState> = {}): InitiativeState {
    return {
      status: 'running',
      sceneId: 'sc-1',
      round: 3,
      turn: 1,
      entries: [
        { key: 'e1', name: 'Willow', kind: 'pc', tokenId: 'w', initiative: 18 },
        { key: 'e2', name: 'Goblin', kind: 'npc', tokenId: 'g', initiative: 12, hp: { current: 0, max: 7 } },
        { key: 'e3', name: 'Off-board scout', kind: 'npc', initiative: 5 },
      ],
      log: [],
      ...over,
    };
  }

  it('marks the current turn, shows the round chip, and dims a downed combatant without touching the current-turn ring', () => {
    useSessionStore.setState({
      session: session({
        initiative: initiative(),
        tokens: tokensState({ w: mkToken('w'), g: mkToken('g', { disposition: 'hostile' }) }),
      }),
    });
    render(<PartyStrip />);

    const disc = screen.getByTestId('party-disc-e2');
    expect(disc.getAttribute('data-current')).toBe('true');
    expect(screen.getByTestId('party-disc-e1').getAttribute('data-current')).toBeNull();
    expect(screen.getByTestId('party-strip').textContent).toContain('R3');
    // Downed: the backdrop dims and the initials mute (M3 review finding 9) — no opacity
    // anywhere, and specifically not on the ring, since this disc is also the current turn's
    // accent ring and dimming that would hide whose turn it is.
    expect(disc.innerHTML).not.toContain('opacity-50');
    expect(disc.querySelector('.bg-surface-2')).not.toBeNull();
    const initialsEl = disc.querySelector('.font-mono')!;
    expect(initialsEl.className).toContain('text-text-muted');
    // The strike bar is gone — a small close glyph marks it down instead.
    expect(disc.querySelector('svg')).not.toBeNull();
  });

  it('dims the ring for a downed combatant whose turn is not current', () => {
    useSessionStore.setState({
      session: session({
        initiative: initiative({
          entries: [
            { key: 'e1', name: 'Willow', kind: 'pc', tokenId: 'w', initiative: 18, hp: { current: 0, max: 10 } },
            { key: 'e2', name: 'Goblin', kind: 'npc', tokenId: 'g', initiative: 12 },
          ],
        }),
        tokens: tokensState({ w: mkToken('w'), g: mkToken('g', { disposition: 'hostile' }) }),
      }),
    });
    render(<PartyStrip />);

    const disc = screen.getByTestId('party-disc-e1');
    expect(disc.getAttribute('data-current')).toBeNull();
    expect(disc.innerHTML).toContain('opacity-50'); // the dispositional ring, not an accent one
  });

  it('renders turn order and skips the frame click for an off-board combatant', () => {
    useSessionStore.setState({
      session: session({
        initiative: initiative(),
        tokens: tokensState({ w: mkToken('w'), g: mkToken('g') }),
      }),
    });
    render(<PartyStrip />);
    const strip = screen.getByTestId('party-strip');
    const order = ['e1', 'e2', 'e3'].map((k) => strip.querySelector(`[data-testid="party-disc-${k}"]`));
    expect(order.every(Boolean)).toBe(true);
    // Off-board: no token to frame, so it renders inert rather than as a button.
    expect(screen.getByTestId('party-disc-e3').tagName).toBe('DIV');
    expect(screen.getByTestId('party-disc-e1').tagName).toBe('BUTTON');
  });

  it('hides when the running encounter is on a different scene', () => {
    useSessionStore.setState({
      session: session({
        initiative: initiative({ sceneId: 'other-scene' }),
        tokens: tokensState({}),
      }),
    });
    render(<PartyStrip />);
    expect(screen.queryByTestId('party-strip')).toBeNull();
  });
});
