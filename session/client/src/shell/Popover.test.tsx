import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { railRefs } from './railRefs';
import { Popover } from './Popover';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };

function Body() {
  return <button data-testid="pt-first-control">Focus me</button>;
}

function TallBody() {
  return <div data-testid="pt-tall" />;
}

/** A ResizeObserver double: jsdom has none, so `Popover`'s overflow effect no-ops without it.
 *  Tests that need to exercise the observed path install this and trigger it by hand. */
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  trigger(): void {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
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

  it('is a non-modal dialog — role="dialog" with aria-modal="false"', () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    const pop = screen.getByTestId('popover');
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.getAttribute('aria-modal')).toBe('false');
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
  // real body node after mount, then trigger the ResizeObserver double so the (deps: [openPanel],
  // M3 review finding 15) overflow effect rechecks without needing a fresh `openPanel`.
  it('warns in dev when a panel body overflows its popover, and never adds a scrollbar', () => {
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver;
    TestResizeObserver.instances = [];

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useShell.setState({ openPanel: 'pt-tall-panel' });
    render(<Popover />);

    const body = screen.getByTestId('popover-body');
    Object.defineProperty(body, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true });
    TestResizeObserver.instances[0]?.trigger();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pt-tall-panel'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'));
    // No scrollbar grown to cope — the warning is the mechanism, not a CSS escape hatch.
    expect(body.className).toContain('overflow-hidden');

    warn.mockRestore();
    globalThis.ResizeObserver = OriginalRO;
  });

  it('never sets up a ResizeObserver when the environment has none', () => {
    const OriginalRO = globalThis.ResizeObserver;
    // @ts-expect-error simulating an environment with no ResizeObserver at all (jsdom's own
    // default — this repo ships no polyfill)
    globalThis.ResizeObserver = undefined;
    useShell.setState({ openPanel: 'pt-panel' });
    expect(() => render(<Popover />)).not.toThrow();
    globalThis.ResizeObserver = OriginalRO;
  });

  // M3 review finding 1: opening a popover from a closed shell used to pin it to the 12px
  // fallback forever — `Rail` mounting after `Popover`, or refreshing straight into a panel,
  // meant `railRefs` had nothing registered yet when the anchor effect first ran, and nothing
  // told it to look again once the icon showed up.
  it('recomputes its anchor once the rail icon registers, even if that happens after open', () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    expect(screen.getByTestId('popover').style.top).toBe('12px'); // fallback — no icon yet

    const icon = document.createElement('button');
    icon.getBoundingClientRect = () => ({ top: 317 }) as unknown as DOMRect;
    act(() => railRefs.set('pt-panel', icon));

    expect(screen.getByTestId('popover').style.top).toBe('317px');
    act(() => railRefs.delete('pt-panel'));
  });

  describe('status-left anchoring (M3 review finding 3)', () => {
    beforeEach(() => {
      registerPanel({
        id: 'pt-status-left',
        title: 'Status Left Panel',
        icon: 'session',
        key: '',
        group: 'prep',
        order: 3,
        rail: false,
        anchor: 'status-left',
        roles: ['dm', 'player'],
        component: Body,
      });
      // `cleanup()` unmounts testing-library's own trees but leaves plain DOM nodes we
      // appended by hand — drop a stale one from a prior test before adding this test's own.
      document.querySelector('[data-testid="scene-name"]')?.remove();
      const sceneNameButton = document.createElement('button');
      sceneNameButton.setAttribute('data-testid', 'scene-name');
      sceneNameButton.focus = vi.fn();
      document.body.appendChild(sceneNameButton);
    });

    it('sits bottom-left above the status bar instead of anchored to a rail icon', () => {
      useShell.setState({ openPanel: 'pt-status-left' });
      render(<Popover />);
      const pop = screen.getByTestId('popover');
      expect(pop.style.left).toBe('12px');
      expect(pop.style.bottom).toBe('40px');
      expect(pop.style.top).toBe('');
    });

    it('returns focus to the scene-name button on close, not a rail icon', () => {
      useShell.setState({ openPanel: 'pt-status-left' });
      const { unmount } = render(<Popover />);
      unmount();
      expect(screen.getByTestId('scene-name').focus).toHaveBeenCalled();
    });
  });
});
