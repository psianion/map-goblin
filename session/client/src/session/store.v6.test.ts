import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type SessionState } from '@dnd/core/src/shared/protocol';
import { useMarks } from '../shell/marks/marks';
import { regionOf, setCells } from '@dnd/mechanics/fog';
import { fogRecuts, useSessionStore } from './store';

vi.mock('../renderer/camera', () => ({ frameWorldPoint: vi.fn() }));

const session: SessionState = {
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's',
  campaignId: 'c',
  activeSceneId: 'scene-1',
  scenes: [],
  players: [],
  modules: {},
};

function seat(role: 'dm' | 'player', identityId = role === 'dm' ? 'dm' : 'p1') {
  useSessionStore.setState({
    session,
    you: { identityId, name: identityId, role, connected: true },
    rollRequested: null,
    effectsEnded: null,
    cameraPull: null,
  });
}

afterEach(() => {
  useMarks.setState({ marks: [] });
});

describe('v6 store slices', () => {
  it('speaks protocol 6', () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });

  it('draws another seat’s mark and skips the echo of its own', () => {
    seat('player');
    const apply = useSessionStore.getState().applyServerMessage;
    apply({ type: 'mark', event: { id: 'm1', from: 'p2', at: 0, sceneId: 'scene-1', ttlMs: 3000, mark: { kind: 'ping', x: 1, y: 2 } } });
    apply({ type: 'mark', event: { id: 'm2', from: 'p1', at: 0, sceneId: 'scene-1', ttlMs: 3000, mark: { kind: 'ping', x: 5, y: 5 } } });
    expect(useMarks.getState().marks.map((m) => m.by)).toEqual(['p2']);
  });

  it('a DM pull recentres a player, never the DM', () => {
    seat('player');
    const pull = { type: 'mark' as const, event: { id: 'm', from: 'dm', at: 0, sceneId: null, ttlMs: 3000, mark: { kind: 'ping' as const, x: 7, y: 8, pull: true } } };
    useSessionStore.getState().applyServerMessage(pull);
    expect(useSessionStore.getState().cameraPull).toMatchObject({ x: 7, y: 8 });
    seat('dm', 'dm2');
    useSessionStore.getState().applyServerMessage(pull);
    expect(useSessionStore.getState().cameraPull).toBeNull();
  });

  it('keeps the last roll request nudge and the last ended effects', () => {
    seat('dm');
    const apply = useSessionStore.getState().applyServerMessage;
    apply({ type: 'roll-requested', request: { requestId: 'q1', label: 'Perception check', dc: 14, targets: null } });
    expect(useSessionStore.getState().rollRequested).toMatchObject({ requestId: 'q1', dc: 14 });
    apply({ type: 'effects-ended', sceneId: 'scene-1', ended: [{ tokenId: 't', tokenName: 'Bram', name: 'Bless' }] });
    expect(useSessionStore.getState().effectsEnded?.ended[0].name).toBe('Bless');
  });

  it('sendMark puts a mark frame on the socket', () => {
    const send = vi.fn();
    useSessionStore.setState({ client: { send } as never });
    useSessionStore.getState().sendMark({ kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } });
    expect(send).toHaveBeenCalledWith({ type: 'mark', mark: { kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } } });
    useSessionStore.setState({ client: null });
  });
});

// The seat re-fetches its cut when fog is switched, or a level loses cleared ground: the referee
// withholds a room whose last cleared cell went, and a held copy only grows by delta.
describe('fogRecuts', () => {
  const GRID = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
  const cells = (list: [number, number][]) => setCells(regionOf(GRID)!, list);
  const fog = (on: boolean, cleared?: Record<string, ReturnType<typeof cells>>) => ({ byScene: { 'scene-1': { on, ...(cleared ? { cleared } : {}) } } });

  it('names a scene whose fog was switched either way', () => {
    expect(fogRecuts(fog(false), fog(true))).toEqual(['scene-1']);
    expect(fogRecuts(fog(true), fog(false))).toEqual(['scene-1']);
    expect(fogRecuts(undefined, fog(true))).toEqual(['scene-1']);
    expect(fogRecuts(undefined, fog(false))).toEqual([]);
  });

  it('names a scene that lost a cleared cell on any level, and none that only gained or kept them', () => {
    const before = fog(true, { up: cells([[0, 0], [1, 1]]), down: cells([[2, 2]]) });
    expect(fogRecuts(before, fog(true, { up: cells([[0, 0]]), down: cells([[2, 2]]) }))).toEqual(['scene-1']);
    expect(fogRecuts(before, fog(true, { up: cells([[0, 0], [1, 1]]) }))).toEqual(['scene-1']);
    expect(fogRecuts(before, fog(true))).toEqual(['scene-1']);
    expect(fogRecuts(before, fog(true, { up: cells([[0, 0], [1, 1], [3, 3]]), down: cells([[2, 2]]) }))).toEqual([]);
    expect(fogRecuts(before, before)).toEqual([]);
    // A level that had nothing set loses nothing.
    expect(fogRecuts(fog(true, { up: regionOf(GRID)! }), fog(true))).toEqual([]);
  });
});
