import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { DOOR_LOCKED, UNKNOWN_DOOR, type DoorsState } from '@dnd/mechanics/doors';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useToasts } from '../../session/toasts';
import {
  DM_ENTITY_ALPHA,
  doorAt,
  doorLabel,
  doorLook,
  doorRefusal,
  doorStatusLabel,
  liveDoors,
} from './doors';
import { DoorPanel } from './DoorPanel';
import { useDoorSelection } from './selection';

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'd1',
    name: 'Gallery Door',
    childType: 'door',
    visible: true,
    wallId: 'w1',
    position: [4, 4],
    angle: 0,
    width: 1.6,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: 'r-a',
    roomB: 'r-b',
    ...over,
  }) as DoorChild;

const PLAIN = door();
const LOCKED = door({ id: 'd2', name: 'Reliquary Door', state: 'locked', position: [10, 4] });
const SECRET = door({ id: 'd3', name: 'Hidden Door', isSecret: true, position: [16, 4] });

const dungeonLayer = (children: DoorChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };

function session(modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: 3,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
    players: [dm],
    modules,
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}

function captureCommands(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({
    client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient,
  });
  return sent;
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null });
  useToasts.setState({ toast: null });
  useDoorSelection.getState().select(null);
  useStore.setState({ layers: [dungeonLayer([PLAIN, LOCKED, SECRET])] });
});

describe('live door state', () => {
  it('seeds every authored door from the map until a command touches it', () => {
    const live = liveDoors(useStore.getState().layers, undefined, 'scene-1');
    expect(live.map((d) => [d.door.id, d.live])).toEqual([
      ['d1', { open: false, locked: false, revealed: true }],
      ['d2', { open: false, locked: true, revealed: true }],
      ['d3', { open: false, locked: false, revealed: false }],
    ]);
  });

  it('lets the session overlay win over the authored default', () => {
    const state: DoorsState = {
      byScene: { 'scene-1': { d2: { open: true, locked: false, revealed: true } } },
    };
    const live = liveDoors(useStore.getState().layers, state, 'scene-1');
    expect(live.find((d) => d.door.id === 'd2')?.live.open).toBe(true);
  });

  it('is empty before a map, and per scene', () => {
    expect(liveDoors([], undefined, 'scene-1')).toEqual([]);
    expect(liveDoors(useStore.getState().layers, undefined, null)).toHaveLength(3);
  });
});

describe('how a door draws (D11 — the DM never loses visibility)', () => {
  it('draws a secret door at full opacity with a badge, never ghosted', () => {
    const look = doorLook(SECRET, { open: false, locked: false, revealed: false });
    expect(look.alpha).toBe(DM_ENTITY_ALPHA);
    expect(look.alpha).toBe(1);
    expect(look.badge).toBe('secret');
  });

  it('never dims anything, whatever the state', () => {
    for (const [d, live] of [
      [PLAIN, { open: false, locked: false, revealed: true }],
      [PLAIN, { open: true, locked: false, revealed: true }],
      [LOCKED, { open: false, locked: true, revealed: true }],
      [SECRET, { open: false, locked: false, revealed: false }],
      [SECRET, { open: true, locked: false, revealed: true }],
    ] as const) {
      expect(doorLook(d, live).alpha).toBe(1);
    }
  });

  it('carries state in shape and badge, not colour alone', () => {
    const shut = doorLook(PLAIN, { open: false, locked: false, revealed: true });
    const open = doorLook(PLAIN, { open: true, locked: false, revealed: true });
    const locked = doorLook(LOCKED, { open: false, locked: true, revealed: true });
    expect(shut.filled).toBe(true);
    expect(open.filled).toBe(false);
    expect(locked.badge).toBe('locked');
    expect(shut.badge).toBeNull();
  });

  it('says the state in words too', () => {
    expect(doorStatusLabel(PLAIN, { open: true, locked: false, revealed: true })).toBe('Open');
    expect(doorStatusLabel(LOCKED, { open: false, locked: true, revealed: true })).toBe(
      'Closed · locked',
    );
    expect(doorStatusLabel(SECRET, { open: false, locked: false, revealed: false })).toBe(
      'Closed · secret',
    );
    expect(doorStatusLabel(SECRET, { open: false, locked: false, revealed: true })).toBe(
      'Closed · secret, revealed',
    );
  });

  it('names a door the way the map does', () => {
    expect(doorLabel(PLAIN, 0)).toBe('Gallery Door');
    expect(doorLabel(door({ name: '  ' }), 4)).toBe('Door 5');
  });
});

describe('doorAt', () => {
  const live = () => liveDoors([dungeonLayer([PLAIN, LOCKED, SECRET])], undefined, 'scene-1');

  it('picks the door under the point and nothing beyond its reach', () => {
    expect(doorAt(live(), 4.2, 4.1)?.door.id).toBe('d1');
    expect(doorAt(live(), 7, 4)).toBeUndefined();
  });

  it('prefers the nearer of two doors in reach', () => {
    const pair = liveDoors(
      [dungeonLayer([door({ id: 'a', position: [0, 0] }), door({ id: 'b', position: [0.5, 0] })])],
      undefined,
      'scene-1',
    );
    expect(doorAt(pair, 0.45, 0)?.door.id).toBe('b');
  });
});

describe('DoorPanel', () => {
  it('lists the scene’s doors and selects one on click, without touching its state', () => {
    useSessionStore.setState({ session: session(), you: player });
    const sent = captureCommands();
    render(<DoorPanel />);

    const rows = screen.getByTestId('door-list').querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[1].getAttribute('data-locked')).toBe('true');
    expect(rows[2].getAttribute('data-secret')).toBe('true');

    fireEvent.click(rows[0].querySelector('button')!);
    expect(sent).toHaveLength(0);
    expect(useDoorSelection.getState().selectedId).toBe('d1');
  });

  it('toggles the selected door only via the explicit control', () => {
    useSessionStore.setState({ session: session(), you: player });
    useDoorSelection.getState().select('d1');
    const sent = captureCommands();
    render(<DoorPanel />);

    fireEvent.click(screen.getByTestId('door-toggle'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'doors', action: 'toggle', payload: { id: 'd1' } });
  });

  it('offers lock and reveal-secret to the DM only, but toggle to anyone', () => {
    useSessionStore.setState({ session: session(), you: dm });
    useDoorSelection.getState().select('d3');
    render(<DoorPanel />);
    expect(screen.getByTestId('door-lock').textContent).toBe('Lock');
    expect(screen.getByTestId('door-reveal-secret')).not.toBeNull();

    cleanup();
    useSessionStore.setState({ you: player });
    render(<DoorPanel />);
    expect(screen.getByTestId('door-toggle')).not.toBeNull();
    expect(screen.queryByTestId('door-lock')).toBeNull();
    expect(screen.queryByTestId('door-reveal-secret')).toBeNull();
  });

  it('unlocks what is locked, and reveals a secret once', () => {
    useSessionStore.setState({ session: session(), you: dm });
    useDoorSelection.getState().select('d2');
    const sent = captureCommands();
    render(<DoorPanel />);

    expect(screen.getByTestId('door-lock').textContent).toBe('Unlock');
    fireEvent.click(screen.getByTestId('door-lock'));
    expect(sent[0]).toMatchObject({ action: 'unlock', payload: { id: 'd2' } });
    // A plain door has no secret to reveal.
    expect(screen.queryByTestId('door-reveal-secret')).toBeNull();
  });

  it('disables reveal-secret once the secret is out', () => {
    const state: DoorsState = {
      byScene: { 'scene-1': { d3: { open: false, locked: false, revealed: true } } },
    };
    useSessionStore.setState({ session: session({ doors: state }), you: dm });
    useDoorSelection.getState().select('d3');
    render(<DoorPanel />);
    const button = screen.getByTestId('door-reveal-secret') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Secret revealed');
  });
});

describe('a refused door', () => {
  it('reads the typed prefixes, never the sentence', () => {
    expect(doorRefusal(`${DOOR_LOCKED}: that door is locked`)).toMatch(/locked/i);
    expect(doorRefusal(`${UNKNOWN_DOOR}: no such door in that scene`)).toMatch(/no longer there/i);
    expect(doorRefusal('rooms.r-1.status needs wasEverRevealed')).toBeNull();
  });

  it('toasts the player who pulled a locked door', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<DoorPanel />);
    expect(useToasts.getState().toast).toBeNull();

    act(() =>
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: `${DOOR_LOCKED}: that door is locked`, at: 1 },
      }),
    );
    expect(useToasts.getState().toast?.message).toMatch(/locked/i);
    // No undo on a refusal — there is nothing to take back.
    expect(useToasts.getState().toast?.action).toBeUndefined();
  });

  it('stays quiet for refusals that are not a door’s', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<DoorPanel />);
    act(() =>
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: 'tokens: no such token', at: 2 },
      }),
    );
    expect(useToasts.getState().toast).toBeNull();
  });
});
