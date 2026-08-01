// #47 D5 — the player's read-only scene preview. The server already redacts `session.scenes`
// down to what the DM made visible (SessionManager.snapshot), so this component has nothing
// left to filter; it only has to render what it is handed and mark the active one.

import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';
import { PlayerScenes } from './PlayerScenes';

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    protocolVersion: 3,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: null,
    scenes: [],
    players: [],
    modules: {},
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ session: null });
});

describe('PlayerScenes', () => {
  it('shows a waiting message before anything has been published', () => {
    useSessionStore.setState({ session: session() });
    render(<PlayerScenes />);
    expect(screen.getByText(/hasn.t published a scene yet/i)).not.toBeNull();
  });

  it('lists only the scenes the server sent — never a button to switch to one', () => {
    useSessionStore.setState({
      session: session({
        activeSceneId: 'sc-2',
        scenes: [
          { id: 'sc-1', name: 'Great Hall' },
          { id: 'sc-2', name: 'Crypt' },
        ],
      }),
    });
    render(<PlayerScenes />);

    const list = screen.getByTestId('player-scene-list');
    expect(list.querySelectorAll('button')).toHaveLength(0);
    expect(list.textContent).toContain('Great Hall');
    expect(list.textContent).toContain('Crypt');
  });

  it('marks the currently active scene and leaves the rest unmarked', () => {
    useSessionStore.setState({
      session: session({
        activeSceneId: 'sc-2',
        scenes: [
          { id: 'sc-1', name: 'Great Hall' },
          { id: 'sc-2', name: 'Crypt' },
        ],
      }),
    });
    render(<PlayerScenes />);

    const items = screen.getAllByRole('listitem');
    const active = items.find((li) => li.textContent?.includes('Crypt'));
    const other = items.find((li) => li.textContent?.includes('Great Hall'));
    expect(active?.getAttribute('aria-current')).toBe('true');
    expect(active?.textContent).toContain('now playing');
    expect(other?.getAttribute('aria-current')).toBe('false');
    expect(other?.textContent).not.toContain('now playing');
  });
});
