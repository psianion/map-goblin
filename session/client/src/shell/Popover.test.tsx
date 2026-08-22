import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { Popover } from './Popover';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };

function Body() {
  return <button data-testid="pt-first-control">Focus me</button>;
}

function TallBody() {
  return <div data-testid="pt-tall" />;
}

beforeEach(() => {
  cleanup();
  useShell.setState({ openPanel: null });
  useSessionStore.setState({ you: dm, session: null });
  registerPanel({
    id: 'pt-panel',
    title: 'Test Panel',
    icon: 'fog',
    key: '',
    group: 'play',
    order: 1,
    roles: ['dm', 'player'],
    component: Body,
  });
  registerPanel({
    id: 'pt-tall-panel',
    title: 'Tall Panel',
    icon: 'fog',
    key: '',
    group: 'play',
    order: 2,
    roles: ['dm'],
    component: TallBody,
  });
});

describe('Popover', () => {
  it('renders nothing until a panel is open', () => {
    render(<Popover />);
    expect(screen.queryByTestId('popover')).toBeNull();
  });

  it('renders the open panel inside the frame, with its title', () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    const pop = screen.getByTestId('popover');
    expect(pop.getAttribute('data-panel')).toBe('pt-panel');
    expect(pop.textContent).toContain('Test Panel');
    expect(screen.getByTestId('pt-first-control')).not.toBeNull();
  });

  it('closes on the close button', () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useShell.getState().openPanel).toBeNull();
  });

  it('closes on Escape', () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShell.getState().openPanel).toBeNull();
  });

  it('does not warn in dev when the body fits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // jsdom does no layout, so scrollHeight/clientHeight stay 0 by default — stub them on the
  // real body node after mount, then force a re-render so the (dependency-less, so it reruns
  // on every commit) overflow effect reads the stubbed sizes.
  it('warns in dev when a panel body overflows its popover, and never adds a scrollbar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useShell.setState({ openPanel: 'pt-tall-panel' });
    const { rerender } = render(<Popover />);

    const body = screen.getByTestId('popover-body');
    Object.defineProperty(body, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true });
    rerender(<Popover />);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pt-tall-panel'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'));
    // No scrollbar grown to cope — the warning is the mechanism, not a CSS escape hatch.
    expect(body.className).toContain('overflow-hidden');
    warn.mockRestore();
  });
});
