import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { usePreparedScenes } from './prepared';
import { ScenesBody, ScenesStrip } from './ScenesTab';
import { useSceneLibrary } from './store';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

function session(): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [],
    players: [dm],
    modules: {},
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}
function capture(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

const remove = vi.fn(async () => {});
const rename = vi.fn(async () => {});

beforeEach(() => {
  cleanup();
  remove.mockClear();
  rename.mockClear();
  usePreparedScenes.setState({ ready: { b: 'm2' }, pending: {} });
  useSessionStore.setState({ you: dm, session: session(), token: null });
  useSceneLibrary.setState({
    scenes: [
      { id: 'a', name: 'Web Gallery', sortIndex: 0, visibleToPlayers: true, mapId: 'm1', updatedAt: 0 },
      { id: 'b', name: 'Crypt', sortIndex: 1, visibleToPlayers: true, mapId: 'm2', updatedAt: 0 },
    ],
    error: null,
    busy: false,
    refresh: async () => {},
    remove,
    rename,
  });
});

describe('Scenes tab', () => {
  it('shows Live and Ready and switches now', () => {
    const sent = capture();
    render(<ScenesStrip />);
    const cards = screen.getAllByTestId('scene-card');
    expect(within(cards[0]!).getByTestId('scene-live')).toBeTruthy();
    expect(within(cards[1]!).getByTestId('scene-ready')).toBeTruthy();
    fireEvent.click(within(cards[1]!).getByTestId('scene-switch'));
    expect(sent[0]).toMatchObject({ module: 'scenes', action: 'activate', payload: { sceneId: 'b' } });
  });

  it('renames a picked scene and deletes it behind the confirm', () => {
    render(
      <>
        <ScenesBody />
        <ScenesStrip />
      </>,
    );
    fireEvent.click(screen.getByText('Crypt'));
    fireEvent.change(screen.getByTestId('scene-rename'), { target: { value: 'Old crypt' } });
    fireEvent.click(screen.getByText('Rename'));
    expect(rename).toHaveBeenCalledWith('b', 'Old crypt');
    fireEvent.click(screen.getByTestId('scene-delete'));
    expect(screen.getByTestId('scene-delete-confirm').textContent).toContain('Fog, tokens and notes go too.');
    fireEvent.click(screen.getByTestId('scene-delete-yes'));
    expect(remove).toHaveBeenCalledWith('b');
  });
});
