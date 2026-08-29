import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { JournalEntry, TriggersState } from '@dnd/mechanics/triggers';
import { sidebarForRole } from '../../session/sidebars';
import { useSessionStore } from '../../session/store';
import { useShell } from '../../shell/shellStore';
import { __resetJournalBadgeForTests } from './journalActivity';
import { JournalSidebar } from './JournalSidebar';

const player: PlayerInfo = { identityId: 'p-1', name: 'Perrin', role: 'player', connected: true };

function session(modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Fieldstone Keep', mapId: 'scene-1' }],
    players: [player],
    modules,
  };
}

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'j1',
  at: Date.now(),
  kicker: 'missive',
  title: 'Scrawled Warning',
  body: '"TURN BACK" — charcoal on bark.',
  sceneId: 'scene-1',
  ...over,
});

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null, token: 'tok' });
  useShell.setState({ sidebarOpen: false });
  __resetJournalBadgeForTests();
});

describe('the journal feed', () => {
  it('shows the exact empty state when nothing has been shared', () => {
    useSessionStore.setState({ session: session({}), you: player });
    render(<JournalSidebar />);
    expect(screen.getByText('Nothing shared yet. What the world tells you will be kept here.')).not.toBeNull();
  });

  it('renders every card, newest first, with kicker label, title, body and time', () => {
    useSessionStore.setState({
      session: session({
        triggers: {
          byScene: {},
          journal: [
            entry({ id: 'j1', title: 'First', kicker: 'lore' }),
            entry({ id: 'j2', title: 'Second', kicker: 'place' }),
          ],
        } as TriggersState,
      }),
      you: player,
    });
    render(<JournalSidebar />);

    const cards = screen.getAllByTestId('journal-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Second'); // newest first
    expect(screen.getByText('Place')).not.toBeNull();
    expect(screen.getByText('Lore')).not.toBeNull();
  });
});

describe('the unread badge', () => {
  it('seeds silently on first mount, counts what arrives after, and clears on open', () => {
    useSessionStore.setState({
      session: session({
        triggers: { byScene: {}, journal: [entry({ id: 'j1' })] } as TriggersState,
      }),
      you: player,
    });
    render(<JournalSidebar />);
    const def = sidebarForRole('player')!;
    expect(def.badge?.()).toBeNull(); // history on first look isn't news

    useSessionStore.setState((s) => ({
      session: {
        ...s.session!,
        modules: {
          triggers: { byScene: {}, journal: [entry({ id: 'j1' }), entry({ id: 'j2', title: 'New' })] } as TriggersState,
        },
      },
    }));
    expect(def.badge?.()).toBe(1);

    useShell.setState({ sidebarOpen: true });
    render(<JournalSidebar />);
    expect(def.badge?.()).toBeNull();
  });
});
