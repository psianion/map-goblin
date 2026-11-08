import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSceneLibrary } from '../../modules/scene/store';
import { usePreparedScenes } from '../../modules/scene/prepared';
import { useSessionStore } from '../../session/store';
import { useTableShell } from '../tableShell';
import { InviteButton, InviteCard } from './InviteCard';
import { Presence } from './Presence';
import { SceneSwitcher } from './SceneSwitcher';
import { SessionMenu } from './SessionMenu';
import { TitleCard } from './TitleCard';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia Stone', role: 'player', connected: true };
const bo: PlayerInfo = { identityId: 'p2', name: 'Bo', role: 'player', connected: false };

function session(players: PlayerInfo[], modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [
      { id: 'a', name: 'Web Gallery', mapId: 'm1' },
      { id: 'b', name: 'Crypt', mapId: 'm2' },
    ],
    players,
    modules,
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

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ you: dm, session: session([dm]), inviteCode: 'ABCD12', token: null, client: null });
  useSceneLibrary.setState({ scenes: [] });
  usePreparedScenes.setState({ ready: {}, pending: {} });
  useTableShell.setState({ dockTab: null, lastDockTab: 'fog', card: null });
});

describe('TitleCard', () => {
  it('names the live scene and opens the World tab from the world chip', () => {
    render(<TitleCard />);
    expect(screen.getByTestId('title-scene').textContent).toBe('Web Gallery');
    expect(screen.getByTestId('title-world').textContent).toMatch(/ · Clear$/);
    fireEvent.click(screen.getByTestId('title-world'));
    expect(useTableShell.getState().dockTab).toBe('world');
  });

  it('gives a player no scene switcher', () => {
    useSessionStore.setState({ you: pia });
    render(<TitleCard />);
    expect(screen.queryByTestId('title-switcher')).toBeNull();
  });
});

describe('SceneSwitcher', () => {
  it('filters, marks the live scene and switches through scenes:activate', () => {
    const sent = capture();
    const done = vi.fn();
    render(<SceneSwitcher onDone={done} />);
    expect(screen.getAllByTestId('scene-row')).toHaveLength(2);
    expect(screen.getByTestId('scene-live')).toBeTruthy();
    fireEvent.change(screen.getByTestId('scene-search'), { target: { value: 'cry' } });
    expect(screen.getAllByTestId('scene-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('scene-switch'));
    expect(sent[0]).toMatchObject({ module: 'scenes', action: 'activate', payload: { sceneId: 'b' } });
    expect(done).toHaveBeenCalled();
  });

  it('shows Ready for a prepared scene in place of Prepare', () => {
    usePreparedScenes.setState({ ready: { b: 'm2' }, pending: {} });
    render(<SceneSwitcher />);
    expect(screen.getByTestId('scene-ready')).toBeTruthy();
    expect(screen.queryByTestId('scene-prepare')).toBeNull();
  });
});

describe('Presence', () => {
  it('draws one avatar per person, away ones marked', () => {
    useSessionStore.setState({ session: session([dm, pia, bo]) });
    render(<Presence />);
    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars.map((a) => a.textContent)).toEqual(['DA', 'PS', 'BO']);
    expect(avatars[2]!.getAttribute('data-connected')).toBe('false');
  });
});

describe('Invite', () => {
  it('shows the big card with code, link and QR box until the first player joins', () => {
    const { rerender } = render(<InviteCard />);
    expect(screen.getByTestId('invite-code').textContent).toBe('ABCD12');
    expect(screen.getByTestId('invite-link').textContent).toContain('/join/ABCD12');
    expect(screen.getByTestId('invite-qr')).toBeTruthy();
    expect(within(screen.getByTestId('invite-card')).getByText('Waiting for players')).toBeTruthy();
    act(() => useSessionStore.setState({ session: session([dm, pia]) }));
    rerender(<InviteCard />);
    expect(screen.queryByTestId('invite-card')).toBeNull();
  });

  it('keeps the Invite button for the DM only', () => {
    const { unmount } = render(<InviteButton />);
    expect(screen.getByTestId('invite-button')).toBeTruthy();
    unmount();
    useSessionStore.setState({ you: pia });
    render(<InviteButton />);
    expect(screen.queryByTestId('invite-button')).toBeNull();
  });
});

describe('SessionMenu', () => {
  const tokens = {
    library: {},
    byScene: { a: { t1: { id: 't1', name: 'Bram', x: 0, y: 0, ownerId: null }, t2: { id: 't2', name: 'Wolf', x: 1, y: 1, ownerId: 'p1' } } },
  };

  it('assigns a token to a player from the roster', async () => {
    const sent = capture();
    useSessionStore.setState({ session: session([dm, pia], { tokens, table: { paused: false, movementLocked: false } }) });
    render(<SessionMenu />);
    fireEvent.click(screen.getByTestId('session-menu'));
    const select = (await screen.findByTestId('assign-p1')) as HTMLSelectElement;
    expect(select.value).toBe('t2');
    fireEvent.change(select, { target: { value: 't1' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(sent.map((m) => m.payload)).toEqual([
      { id: 't1', identityId: 'p1' },
      { id: 't2', identityId: null },
    ]);
  });

  it('pauses the table and locks movement through the table module', async () => {
    const sent = capture();
    useSessionStore.setState({ session: session([dm], { table: { paused: false, movementLocked: false } }) });
    render(<SessionMenu />);
    fireEvent.click(screen.getByTestId('session-menu'));
    fireEvent.click(await screen.findByRole('switch', { name: 'Pause the table' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Lock token movement' }));
    expect(sent).toEqual([
      expect.objectContaining({ module: 'table', action: 'pause', payload: { on: true } }),
      expect.objectContaining({ module: 'table', action: 'lock-movement', payload: { on: true } }),
    ]);
    expect(screen.getByTestId('session-invite-code').textContent).toBe('ABCD12');
    expect(screen.getByTestId('export-campaign')).toBeTruthy();
    expect(screen.getByTestId('library-download').textContent).toMatch(/^Download the full library/);
    fireEvent.click(screen.getByTestId('end-session'));
    expect(screen.getByTestId('end-session-confirm')).toBeTruthy();
  });

  it('gives a player Leave table and no DM controls', async () => {
    useSessionStore.setState({ you: pia, session: session([dm, pia]) });
    render(<SessionMenu />);
    fireEvent.click(screen.getByTestId('session-menu'));
    expect(await screen.findByTestId('leave-table')).toBeTruthy();
    expect(screen.queryByTestId('end-session')).toBeNull();
    expect(screen.queryByTestId('assign-p1')).toBeNull();
    expect(screen.queryByTestId('library-download')).toBeNull();
  });
});
