import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../../session/store';
import { resolvePanelTitle, usePanel } from '../../session/panels';

vi.mock('../../renderer/camera', () => ({ frameWorldPoint: vi.fn() }));
import { frameWorldPoint } from '../../renderer/camera';
import { MePanel } from './MePanel';

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
    x: 3,
    y: 4,
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
  useSessionStore.setState({
    session: null,
    presence: [],
    mapData: null,
    you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
    sendCommand: vi.fn(),
  });
  vi.mocked(frameWorldPoint).mockClear();
});
afterEach(() => cleanup());

describe('MePanel — unclaimed', () => {
  it('lists claimable tokens with a Claim button, marking the first data-testid="claim-button"', () => {
    useSessionStore.setState({
      session: session({
        tokens: tokensState({
          a: mkToken('a', { name: 'Karlach' }),
          b: mkToken('b', { name: 'Marra' }),
          hidden: mkToken('hidden', { name: 'Secret', hidden: true }),
          taken: mkToken('taken', { name: 'Taken', ownerId: 'someone-else' }),
        }),
      }),
    });
    render(<MePanel />);

    expect(screen.getByText('Karlach')).toBeTruthy();
    expect(screen.getByText('Marra')).toBeTruthy();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.queryByText('Taken')).toBeNull();
    expect(screen.getByTestId('claim-button')).toBeTruthy();
  });

  it('sends the claim command for the clicked row', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({
      sendCommand,
      session: session({ tokens: tokensState({ a: mkToken('a', { name: 'Karlach' }) }) }),
    });
    render(<MePanel />);
    fireEvent.click(screen.getByTestId('claim-button'));
    expect(sendCommand).toHaveBeenCalledWith('tokens', 'claim', { id: 'a' });
  });

  it('says so when nothing is claimable', () => {
    useSessionStore.setState({ session: session({ tokens: tokensState({}) }) });
    render(<MePanel />);
    expect(screen.getByText('No claimable tokens on this scene.')).toBeTruthy();
  });
});

describe('MePanel — one claimed token', () => {
  it('shows "—" for HP and the unset labels with no encounter running', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ a: mkToken('a', { name: 'Karlach', ownerId: 'me' }) }) }),
    });
    render(<MePanel />);
    const panel = screen.getByTestId('me-panel');
    // The name is the popover's own title/subtitle, not repeated in the body.
    expect(panel.textContent).not.toContain('Karlach');
    expect(panel.textContent).toContain('—');
    expect(panel.textContent).toContain('Medium · friendly');
    expect(panel.textContent).toContain('none');
    expect(panel.textContent).toContain('nothing special');
    expect(panel.textContent).toContain('no light');
  });

  it('reads HP and conditions off the matching initiative entry once an encounter runs', () => {
    useSessionStore.setState({
      session: session({
        tokens: tokensState({ a: mkToken('a', { ownerId: 'me' }) }),
        initiative: {
          status: 'running',
          sceneId: 'sc-1',
          round: 2,
          turn: 0,
          entries: [
            {
              key: 'k1',
              name: 'Karlach',
              kind: 'pc',
              identityId: 'me',
              tokenId: 'a',
              initiative: 14,
              hp: { current: 20, max: 31 },
              conditions: ['prone'],
            },
          ],
          log: [],
        } satisfies InitiativeState,
      }),
    });
    render(<MePanel />);
    const panel = screen.getByTestId('me-panel');
    expect(panel.textContent).toContain('20 / 31');
    expect(panel.textContent).toContain('Prone');
  });

  it('reads sight and light off the token, in map units', () => {
    useSessionStore.setState({
      session: session({
        tokens: tokensState({
          a: mkToken('a', {
            ownerId: 'me',
            sight: { range: 12, angle: 360, visionMode: 'darkvision' },
            light: { dim: 8, bright: 4, color: '#ffbb66', angle: 360 },
          }),
        }),
      }),
    });
    render(<MePanel />);
    const panel = screen.getByTestId('me-panel');
    // No map scale set: falls back to cells (1 cell == 1 unit).
    expect(panel.textContent).toContain('12 cells · darkvision');
    expect(panel.textContent).toContain('torch · 4 / 8 cells');
  });

  // M3 review finding 10 — `{0, 0}` is the wire's redacted/unset shape, not a real empty
  // pool; reading it as "down" for the player's OWN token was the bug.
  it('reads a {0, 0} entry as unset ("—"), not as downed', () => {
    useSessionStore.setState({
      session: session({
        tokens: tokensState({ a: mkToken('a', { ownerId: 'me' }) }),
        initiative: {
          status: 'running',
          sceneId: 'sc-1',
          round: 1,
          turn: 0,
          entries: [
            {
              key: 'k1',
              name: 'Karlach',
              kind: 'pc',
              identityId: 'me',
              tokenId: 'a',
              initiative: 14,
              hp: { current: 0, max: 0 },
            },
          ],
          log: [],
        } satisfies InitiativeState,
      }),
    });
    render(<MePanel />);
    const panel = screen.getByTestId('me-panel');
    expect(panel.textContent).toContain('—');
    expect(panel.textContent).not.toContain('0 / 0');
    // No HP bar drawn for an unset pool.
    expect(panel.querySelector('.bg-danger, .bg-text-secondary')).toBeNull();
  });
});

describe('MePanel — multiple claimed tokens', () => {
  it('shows a compact row per token and expands one on click', () => {
    useSessionStore.setState({
      session: session({
        tokens: tokensState({
          a: mkToken('a', { name: 'Karlach', ownerId: 'me' }),
          b: mkToken('b', { name: 'Familiar', ownerId: 'me' }),
        }),
      }),
    });
    render(<MePanel />);

    expect(screen.getByTestId('me-row-a')).toBeTruthy();
    expect(screen.getByTestId('me-row-b')).toBeTruthy();
    expect(screen.queryByText('nothing special')).toBeNull(); // nothing expanded yet

    fireEvent.click(screen.getByTestId('me-row-a'));
    expect(screen.getByText('nothing special')).toBeTruthy();

    // Expanding the other row collapses the first.
    fireEvent.click(screen.getByTestId('me-row-b'));
    expect(screen.getAllByText('nothing special')).toHaveLength(1);
  });
});

describe('MePanel footer', () => {
  it('frames the claimed token and always shows the DM-owned-fields note', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ a: mkToken('a', { x: 7, y: 9, ownerId: 'me' }) }) }),
    });
    const Footer = usePanel('me')!.footer!;
    render(<Footer />);
    expect(screen.getByText('HP and conditions are set by the DM')).toBeTruthy();
    fireEvent.click(screen.getByText('Find me'));
    expect(frameWorldPoint).toHaveBeenCalledWith(7, 9);
  });

  it('title is always "Me"; the claimed token’s name is the subtitle instead (M3 review finding 4)', () => {
    useSessionStore.setState({
      session: session({ tokens: tokensState({ a: mkToken('a', { name: 'Karlach', ownerId: 'me' }) }) }),
    });
    expect(resolvePanelTitle(usePanel('me')!)).toBe('Me');
    expect(usePanel('me')!.subtitle?.()).toBe('Karlach');

    useSessionStore.setState({ session: session({ tokens: tokensState({}) }) });
    expect(resolvePanelTitle(usePanel('me')!)).toBe('Me');
    expect(usePanel('me')!.subtitle?.()).toBeNull();
  });
});
