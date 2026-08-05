// D3 layer 1 — a shut door is a wall for light, for both roles. The chain under test is
// live door state → the core store's door children → core's occlusion pass, so the last
// assertion is made with the same `buildOcclusionSegments` the editor lights with.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildOcclusionSegments } from '@dnd/core/src/shared/occlusion';
import type { DoorChild, WallSegment } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../../session/store';
import { authoredStateOf, lightingDrift, syncDoorsToLighting } from './doorLighting';
import { liveSceneDoors } from './DoorRenderer';

const wall = (): WallSegment => ({
  id: 'w1',
  points: [
    [0, 0],
    [10, 0],
  ],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 0.2,
  roughness: 0,
});

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'd1',
    childType: 'door',
    visible: true,
    wallId: 'w1',
    position: [5, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: 'r1',
    roomB: 'r2',
    ...over,
  }) as DoorChild;

const dungeon = (children: DoorChild[]): Layer =>
  ({
    id: 'l1',
    type: 'dungeon',
    visible: true,
    children,
    standaloneWalls: [wall()],
    rooms: [],
  }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true };

const session = (doors: Record<string, unknown>): SessionState =>
  ({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [dm],
    modules: { doors: { byScene: { 'scene-1': doors } } },
  }) as SessionState;

/** Does light get through where the door sits? */
const doorBlocksLight = (): boolean => {
  const layer = useStore.getState().layers[0] as unknown as {
    standaloneWalls: WallSegment[];
    children: DoorChild[];
  };
  const doors = layer.children.filter((c) => c.childType === 'door');
  const segments = buildOcclusionSegments(layer.standaloneWalls, doors);
  return segments.filter((s) => s.sourceType === 'door').every((s) => s.blocksLight);
};

describe('authoredStateOf', () => {
  it('maps the table’s answer onto the map’s own vocabulary', () => {
    expect(authoredStateOf({ open: true, locked: false, revealed: true })).toBe('open');
    expect(authoredStateOf({ open: false, locked: false, revealed: true })).toBe('closed');
    expect(authoredStateOf({ open: false, locked: true, revealed: true })).toBe('locked');
  });
});

describe('lightingDrift', () => {
  it('is empty when the map already says what the table is playing', () => {
    const shut = door({ state: 'closed' });
    const drift = lightingDrift([{ door: shut, live: { open: false, locked: false, revealed: true } }]);
    expect(drift.size).toBe(0);
  });

  it('names only the doors that moved', () => {
    const drift = lightingDrift([
      { door: door({ id: 'd1', state: 'closed' }), live: { open: true, locked: false, revealed: true } },
      { door: door({ id: 'd2', state: 'open' }), live: { open: true, locked: false, revealed: true } },
    ]);
    expect([...drift]).toEqual([['d1', 'open']]);
  });
});

describe('syncDoorsToLighting', () => {
  beforeEach(() => {
    useStore.setState({ layers: [dungeon([door({ state: 'closed' })])] });
    useSessionStore.setState({ session: session({}), you: dm });
  });

  it('flips the occlusion input when the table opens a door', () => {
    const stop = syncDoorsToLighting();
    expect(doorBlocksLight()).toBe(true);

    useSessionStore.setState({
      session: session({ d1: { open: true, locked: false, revealed: true } }),
    });

    expect(liveSceneDoors()[0].live.open).toBe(true);
    expect(doorBlocksLight()).toBe(false);
    stop();
  });

  it('shuts it again — and a locked door is a shut one for light', () => {
    const stop = syncDoorsToLighting();
    useSessionStore.setState({
      session: session({ d1: { open: true, locked: false, revealed: true } }),
    });
    useSessionStore.setState({
      session: session({ d1: { open: false, locked: true, revealed: true } }),
    });

    const child = (useStore.getState().layers[0] as unknown as { children: DoorChild[] }).children[0];
    expect(child.state).toBe('locked');
    expect(doorBlocksLight()).toBe(true);
    stop();
  });

  it('settles instead of looping — the write it makes finds nothing left to change', () => {
    const stop = syncDoorsToLighting();
    let writes = 0;
    const unsub = useStore.subscribe(() => {
      writes += 1;
    });

    useSessionStore.setState({
      session: session({ d1: { open: true, locked: false, revealed: true } }),
    });

    expect(writes).toBe(1);
    unsub();
    stop();
  });

  it('stops writing once unsubscribed', () => {
    syncDoorsToLighting()();
    useSessionStore.setState({
      session: session({ d1: { open: true, locked: false, revealed: true } }),
    });
    const child = (useStore.getState().layers[0] as unknown as { children: DoorChild[] }).children[0];
    expect(child.state).toBe('closed');
  });
});
