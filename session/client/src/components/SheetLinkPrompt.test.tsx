import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDetectedSheet } from '../session/detectedSheet';
import { useSessionStore } from '../session/store';
import { SheetLinkPrompt } from './SheetLinkPrompt';

const ME: PlayerInfo = { identityId: 'me', name: 'Willow', role: 'player', connected: true };
const SHEET = { name: 'Thalia Brightwood', url: 'https://www.dndbeyond.com/characters/1' };
const SHEET_B = { name: 'Grum the Unwise', url: 'https://www.dndbeyond.com/characters/2' };

function session(modules: SessionState['modules']): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'sc-1',
    scenes: [],
    players: [ME],
    modules,
  };
}

/** A claimed token with no sheet yet — the only shape the prompt shows for. */
const unbound = (): SessionState['modules'] => ({
  tokens: {
    library: {},
    byScene: { 'sc-1': { a: { id: 'a', name: 'Karlach', x: 1, y: 1, ownerId: 'me' } } },
  },
});

beforeEach(() => {
  useDetectedSheet.setState({ sheet: null, dismissed: new Set() });
  useSessionStore.setState({ session: null, you: ME, sendCommand: vi.fn() });
});
afterEach(() => cleanup());

describe('SheetLinkPrompt', () => {
  it('renders nothing with no sheet stashed', () => {
    useSessionStore.setState({ session: session(unbound()) });
    render(<SheetLinkPrompt />);
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();
  });

  it('renders nothing when the claimed token already has a sheet (first-sheet-sticks)', () => {
    useDetectedSheet.getState().stash(SHEET);
    useSessionStore.setState({
      session: session({
        tokens: {
          library: {},
          byScene: { 'sc-1': { a: { id: 'a', name: 'Karlach', x: 1, y: 1, ownerId: 'me', sheet: SHEET } } },
        },
      }),
    });
    render(<SheetLinkPrompt />);
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();
  });

  it('renders nothing once dismissed for that sheet', () => {
    useDetectedSheet.getState().stash(SHEET);
    useDetectedSheet.getState().dismiss(SHEET.name);
    useSessionStore.setState({ session: session(unbound()) });
    render(<SheetLinkPrompt />);
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();
  });

  it('offers to link, names the target token, and sends tokens:update on confirm', () => {
    const sendCommand = vi.fn();
    useDetectedSheet.getState().stash(SHEET);
    useSessionStore.setState({ session: session(unbound()), sendCommand });
    render(<SheetLinkPrompt />);
    expect(screen.getByText('Link Thalia Brightwood to Karlach?')).toBeTruthy();

    fireEvent.click(screen.getByTestId('sheet-link-confirm'));
    expect(sendCommand).toHaveBeenCalledWith('tokens', 'update', { id: 'a', sheet: SHEET });
  });

  it('dismisses without sending anything on "Not now", and stays gone', () => {
    const sendCommand = vi.fn();
    useDetectedSheet.getState().stash(SHEET);
    useSessionStore.setState({ session: session(unbound()), sendCommand });
    render(<SheetLinkPrompt />);

    fireEvent.click(screen.getByTestId('sheet-link-dismiss'));
    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();
  });

  // ── Two claimed tokens (PC + familiar) — the review-found loop ────────────

  const twoTokens = (aSheet?: typeof SHEET): SessionState['modules'] => ({
    tokens: {
      library: {},
      byScene: {
        'sc-1': {
          a: { id: 'a', name: 'Karlach', x: 1, y: 1, ownerId: 'me', ...(aSheet ? { sheet: aSheet } : {}) },
          b: { id: 'b', name: 'Familiar', x: 2, y: 2, ownerId: 'me' },
        },
      },
    },
  });

  it('does not re-offer the same sheet for a second claimed token once the first holds it', () => {
    useDetectedSheet.getState().stash(SHEET);
    useSessionStore.setState({ session: session(twoTokens(SHEET)) });
    render(<SheetLinkPrompt />);
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();
  });

  it('unlinking the first token brings the prompt back for the same sheet', () => {
    useDetectedSheet.getState().stash(SHEET);
    // Karlach's binding was just cleared (MePanel's Unlink) — same detected sheet, no token
    // holds it any more.
    useSessionStore.setState({ session: session(twoTokens(undefined)) });
    render(<SheetLinkPrompt />);
    expect(screen.getByText('Link Thalia Brightwood to Karlach?')).toBeTruthy();
  });

  it('a different detected sheet still prompts for the second token', () => {
    useDetectedSheet.getState().stash(SHEET_B);
    useSessionStore.setState({ session: session(twoTokens(SHEET)) });
    render(<SheetLinkPrompt />);
    expect(screen.getByText('Link Grum the Unwise to Familiar?')).toBeTruthy();
  });

  // ── Per-key dismissal (review gap 5b) ──────────────────────────────────────

  it('dismissing one detected sheet does not hide the prompt for a different one', () => {
    useDetectedSheet.getState().stash(SHEET);
    useDetectedSheet.getState().dismiss('Thalia Brightwood');
    useSessionStore.setState({ session: session(unbound()) });
    const { rerender } = render(<SheetLinkPrompt />);
    expect(screen.queryByTestId('sheet-link-prompt')).toBeNull();

    useDetectedSheet.getState().stash(SHEET_B);
    rerender(<SheetLinkPrompt />);
    expect(screen.getByText('Link Grum the Unwise to Karlach?')).toBeTruthy();
  });
});
