import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';

const info = vi.fn();
vi.mock('@dnd/ui/toast', () => ({ notify: { info: (m: string) => info(m) } }));

const { useSessionStore } = await import('./store');

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

function state(activeSceneId: string, mapId: string): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: [
      { id: 'a', name: 'A', mapId },
      { id: 'b', name: 'B', mapId: 'mb' },
    ],
    players: [],
    modules: {},
  };
}

beforeEach(() => {
  info.mockClear();
  useSessionStore.setState({ session: state('a', 'm1'), you: dm });
});

describe('republish notice', () => {
  it('toasts once when the live scene gets a new map', () => {
    useSessionStore.getState().applyServerMessage({ type: 'scene-changed', sceneId: 'a', mapId: 'm2' });
    useSessionStore.getState().applyServerMessage({ type: 'session-state', state: state('a', 'm2'), you: dm });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Map updated from the canvas');
  });

  it('also catches it when the snapshot arrives first', () => {
    useSessionStore.getState().applyServerMessage({ type: 'session-state', state: state('a', 'm3'), you: dm });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on a switch to another scene', () => {
    useSessionStore.getState().applyServerMessage({ type: 'scene-changed', sceneId: 'b', mapId: 'mb' });
    expect(info).not.toHaveBeenCalled();
  });
});
