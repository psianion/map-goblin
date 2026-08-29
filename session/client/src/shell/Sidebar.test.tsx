import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerSidebar } from '../session/sidebars';
import { useSessionStore } from '../session/store';
import { Sidebar } from './Sidebar';
import { useShell } from './shellStore';

const dm = { identityId: 'd', name: 'DM', role: 'dm' as const, connected: true };
const player = { identityId: 'p', name: 'Iris', role: 'player' as const, connected: true };

/** jsdom ships no matchMedia — treat that as "not narrow" (desktop) unless a test opts in. */
function stubNarrow(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

beforeEach(() => {
  cleanup();
  useShell.setState({ sidebarOpen: false });
  useSessionStore.setState({ you: null });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('Sidebar', () => {
  it('renders nothing before a role is known', () => {
    render(<Sidebar />);
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });

  it('falls back to a role-based title and an empty state with nothing registered', () => {
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar').getAttribute('aria-label')).toBe('Prep');
    expect(screen.getByTestId('sidebar-body').textContent).toContain('Nothing here yet');
  });

  it('renders a registered body, keyed by role', () => {
    registerSidebar('player', { title: 'Journal', component: () => <p>A missive.</p> });
    useSessionStore.setState({ you: player });
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar').getAttribute('aria-label')).toBe('Journal');
    expect(screen.getByTestId('sidebar-body').textContent).toContain('A missive.');
  });

  it('opens on the edge toggle and closes on the header collapse button', () => {
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    expect(useShell.getState().sidebarOpen).toBe(false);

    fireEvent.click(screen.getByTestId('sidebar-edge-toggle'));
    expect(useShell.getState().sidebarOpen).toBe(true);

    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(useShell.getState().sidebarOpen).toBe(false);
  });

  it('slides in with a transition that reduced motion turns off', () => {
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    const aside = screen.getByTestId('sidebar');
    expect(aside.className).toContain('transition-transform');
    expect(aside.className).toContain('motion-reduce:transition-none');
    expect(aside.className).toContain('-translate-x-full'); // closed, off-screen
    act(() => useShell.getState().setSidebar(true));
    expect(screen.getByTestId('sidebar').className).toContain('translate-x-0');
  });

  it('shows the closed-sidebar badge from the registry, never while open', () => {
    registerSidebar('dm', { title: 'Prep', component: () => null, badge: () => 3 });
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar-edge-badge').textContent).toBe('3');

    act(() => useShell.getState().setSidebar(true));
    expect(screen.queryByTestId('sidebar-edge-badge')).toBeNull();
  });

  it('renders no scrim on a wide viewport', () => {
    stubNarrow(false);
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    expect(screen.queryByTestId('sidebar-scrim')).toBeNull();
  });

  it('overlays with a clickable scrim under the 900px breakpoint', () => {
    stubNarrow(true);
    useSessionStore.setState({ you: dm });
    render(<Sidebar />);
    act(() => useShell.getState().setSidebar(true));
    const scrim = screen.getByTestId('sidebar-scrim');
    expect(scrim.className).toContain('opacity-100');

    fireEvent.click(scrim);
    expect(useShell.getState().sidebarOpen).toBe(false);
  });
});
