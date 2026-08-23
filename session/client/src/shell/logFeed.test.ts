import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../session/store';
import { markLogSeen, usePostRoll, useLogEntries, useUnreadCount } from './logFeed';

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
  useSessionStore.setState({
    connection: 'closed',
    session: null,
    presence: [],
    mapData: null,
    you: null,
  });
  // Unread is a module-level store; each test that cares about it resets it explicitly.
  act(() => markLogSeen());
});

describe('useLogEntries', () => {
  it('merges every source, tags each kind, and sorts oldest first', () => {
    useSessionStore.setState({
      session: session({
        rolls: { log: [{ id: 'r1', at: 30, playerName: 'Willow', total: 17, visibility: 'public' }] },
        doors: { log: [{ id: 'd1', at: 20, sceneId: 'sc-1', actor: 'Ayla', action: 'opened' }] },
        triggers: {
          byScene: {
            'sc-1': { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env: {}, prompts: [], log: [{ id: 't1', at: 40, text: 'The floor cracks.' }] },
          },
        },
        initiative: {
          status: 'running',
          sceneId: 'sc-1',
          round: 1,
          turn: 0,
          entries: [],
          log: [{ id: 'i1', at: 10, text: "Ayla's turn." }],
        },
      }),
      presence: [{ id: 'p1', at: 50, name: 'Borin', kind: 'joined' }],
    });

    const { result } = renderHook(() => useLogEntries());
    expect(result.current.map((e) => e.kind)).toEqual([
      'combat',
      'table',
      'roll',
      'trigger',
      'presence',
    ]);
    expect(result.current.map((e) => e.at)).toEqual([10, 20, 30, 40, 50]);
  });

  it('reads empty before the join snapshot lands', () => {
    const { result } = renderHook(() => useLogEntries());
    expect(result.current).toEqual([]);
  });
});

describe('usePostRoll', () => {
  it('posts a manual roll and, while gathering initiative, captures the trailing number', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({
      sendCommand,
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({
        initiative: {
          status: 'gathering',
          sceneId: 'sc-1',
          round: 0,
          turn: 0,
          entries: [{ key: 'k1', name: 'Willow', kind: 'pc', identityId: 'me', initiative: null }],
          log: [],
        },
      }),
    });

    const { result } = renderHook(() => usePostRoll());
    act(() => result.current('initiative 17'));

    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'initiative 17',
      visibility: 'public',
    });
    expect(sendCommand).toHaveBeenCalledWith('initiative', 'set', { key: 'k1', value: 17 });
  });

  it('posts private when asked — RollBar’s whisper toggle', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, you: null, session: session({}) });
    const { result } = renderHook(() => usePostRoll());
    act(() => result.current('stealth 17', 'private'));
    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'stealth 17',
      visibility: 'private',
    });
  });

  it('does nothing for a blank line', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, session: session({}) });
    const { result } = renderHook(() => usePostRoll());
    act(() => result.current('   '));
    expect(sendCommand).not.toHaveBeenCalled();
  });
});

describe('useUnreadCount', () => {
  it('counts entries newer than the last time the drawer was seen', () => {
    useSessionStore.setState({
      session: session({
        rolls: {
          log: [
            { id: 'r1', at: 1000, playerName: 'Willow', total: 10, visibility: 'public' },
            { id: 'r2', at: 2000, playerName: 'Willow', total: 12, visibility: 'public' },
          ],
        },
      }),
    });

    act(() => markLogSeen());
    const before = Date.now();
    expect(before).toBeGreaterThanOrEqual(2000);

    const { result } = renderHook(() => useUnreadCount());
    expect(result.current).toBe(0); // both rolls are older than "now"

    act(() => {
      useSessionStore.setState({
        session: session({
          rolls: {
            log: [
              { id: 'r1', at: 1000, playerName: 'Willow', total: 10, visibility: 'public' },
              { id: 'r2', at: 2000, playerName: 'Willow', total: 12, visibility: 'public' },
              { id: 'r3', at: Date.now() + 10_000, playerName: 'Willow', total: 9, visibility: 'public' },
            ],
          },
        }),
      });
    });
    expect(result.current).toBe(1);
  });
});
