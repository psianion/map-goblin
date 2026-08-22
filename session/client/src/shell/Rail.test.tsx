import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { Rail } from './Rail';

const stub = () => null;
const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p', name: 'Iris', role: 'player', connected: true };

function seed() {
  registerPanel({
    id: 'rt-play-a',
    title: 'Play A',
    icon: 'fog',
    key: 'A',
    group: 'play',
    order: 1,
    roles: ['dm', 'player'],
    component: stub,
  });
  registerPanel({
    id: 'rt-play-b',
    title: 'Play B',
    icon: 'doors',
    key: 'B',
    group: 'play',
    order: 2,
    roles: ['dm'],
    component: stub,
  });
  registerPanel({
    id: 'rt-prep',
    title: 'Prep',
    icon: 'world',
    key: 'W',
    group: 'prep',
    order: 3,
    roles: ['dm', 'player'],
    component: stub,
  });
  registerPanel({
    id: 'rt-log',
    title: 'Log',
    icon: 'log',
    key: 'L',
    group: 'log',
    order: 4,
    roles: ['dm', 'player'],
    component: stub,
  });
  registerPanel({
    id: 'rt-hidden',
    title: 'Hidden',
    icon: 'session',
    key: '',
    group: 'prep',
    rail: false,
    order: 5,
    roles: ['dm', 'player'],
    component: stub,
  });
}

beforeEach(() => {
  cleanup();
  seed();
  useShell.setState({ openPanel: null, drawerOpen: false });
  useSessionStore.setState({ you: null, session: null });
});

describe('Rail', () => {
  it('renders only this role’s panels, in group order (play, prep, log), and drops rail:false ones', () => {
    useSessionStore.setState({ you: player });
    render(<Rail />);
    const rail = screen.getByTestId('rail');
    const ids = [...rail.querySelectorAll('[data-testid^="rail-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    // rt-play-b is dm-only; rt-hidden is rail:false — neither shows for a player.
    expect(ids).toEqual(['rail-rt-play-a', 'rail-rt-prep', 'rail-rt-log']);
  });

  it('includes a dm-only panel for the dm seat', () => {
    useSessionStore.setState({ you: dm });
    render(<Rail />);
    expect(screen.getByTestId('rail-rt-play-b')).not.toBeNull();
  });

  it('toggles the shell panel on click; the log group toggles the drawer instead', () => {
    useSessionStore.setState({ you: dm });
    render(<Rail />);

    fireEvent.click(screen.getByTestId('rail-rt-play-a'));
    expect(useShell.getState().openPanel).toBe('rt-play-a');
    fireEvent.click(screen.getByTestId('rail-rt-play-a'));
    expect(useShell.getState().openPanel).toBeNull();

    fireEvent.click(screen.getByTestId('rail-rt-log'));
    expect(useShell.getState().drawerOpen).toBe(true);
    expect(useShell.getState().openPanel).toBeNull();
  });

  it('shows a badge only for the panel that supplies one', () => {
    registerPanel({
      id: 'rt-badged',
      title: 'Badged',
      icon: 'initiative',
      key: '',
      group: 'play',
      order: 0,
      roles: ['dm'],
      component: stub,
      badge: () => 'R1',
    });
    useSessionStore.setState({ you: dm });
    render(<Rail />);
    expect(screen.getByTestId('rail-rt-badged').querySelector('[data-badge]')?.textContent).toBe('R1');
    expect(screen.getByTestId('rail-rt-play-a').querySelector('[data-badge]')).toBeNull();
  });
});
