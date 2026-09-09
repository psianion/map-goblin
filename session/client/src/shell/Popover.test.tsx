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

/** Nothing focusable at all — an empty Triggers list, or Session before there is a code or a
 *  roster row (M3 review findings 14/15). */
function EmptyBody() {
  return <p>Nothing here yet.</p>;
}

/** Flushes the `requestAnimationFrame` `Popover`'s focus effect defers to. */
const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

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
  useShell.setState({ openPanel: null, sidebarOpen: false });
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
  registerPanel({
    id: 'pt-empty-panel',
    title: 'Empty Panel',
    icon: 'fog',
    key: '',
    group: 'play',
    order: 4,
    roles: ['dm', 'player'],
    component: EmptyBody,
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

  // M3 review finding 11: a body that seeds its own first control from a `useEffect` (the
  // Scene cold-open) has not painted it on the same pass Popover mounted — focusing
  // synchronously grabbed whatever was there first instead. Deferring a frame means the
  // synchronous read here has nothing to find yet; only the RAF flush moves focus in.
  it('defers focus to the next animation frame instead of grabbing whatever exists synchronously on open', async () => {
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    expect(document.activeElement).not.toBe(screen.getByTestId('pt-first-control'));

    await nextFrame();
    expect(document.activeElement).toBe(screen.getByTestId('pt-first-control'));
  });

  // M3 review findings 14/15: an empty Triggers list, or Session before the invite code or a
  // roster row exists, leaves nothing focusable in the body — the popover falls back to its
  // own close button instead of leaving focus stranded on `document.body`.
  it('falls back to the close button when the body has nothing focusable', async () => {
    useShell.setState({ openPanel: 'pt-empty-panel' });
    render(<Popover />);

    await nextFrame();
    expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement);
  });

  it('does not warn in dev when the body fits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useShell.setState({ openPanel: 'pt-panel' });
    render(<Popover />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // jsdom does no layout, so scrollHeight/clientHeight stay 0 by default — stub them on the
  // real body node after mount, then trigger the ResizeObserver doubles so the (deps:
  // [openPanel], M3 review finding 15) overflow effect rechecks without needing a fresh
  // `openPanel`. A rail-anchored panel now installs *two* observers over the body — this
  // one's own overflow check, and the anchor `recalc`'s (below) — so every instance gets
  // triggered rather than assuming a fixed index; `recalc` also calls `setTop`, hence `act`.
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
    act(() => {
      TestResizeObserver.instances.forEach((ro) => ro.trigger());
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pt-tall-panel'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'));
    // No scrollbar grown to cope — the warning is the mechanism, not a CSS escape hatch.
    expect(body.className).toContain('overflow-hidden');

    warn.mockRestore();
    globalThis.ResizeObserver = OriginalRO;
  });

  // The anchor clamp used to read `rootRef`'s own (already-capped) rendered height, so a
  // panel that grew after open could never be discovered as wanting more room — `top` stayed
  // wherever it first landed and the extra content just clipped. A `ResizeObserver` over the
  // body re-runs the same clamp off the body's true `scrollHeight` instead, live.
  it('re-clamps top/maxHeight off the body when it grows after open, not just on window resize', () => {
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver;
    TestResizeObserver.instances = [];
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    useShell.setState({ openPanel: 'pt-tall-panel' });
    render(<Popover />);

    const icon = document.createElement('button');
    icon.getBoundingClientRect = () => ({ top: 600 }) as unknown as DOMRect;
    act(() => railRefs.set('pt-tall-panel', icon));

    const pop = screen.getByTestId('popover');
    const body = screen.getByTestId('popover-body');

    // A small body: top sits right at the icon, nothing to clamp yet.
    Object.defineProperty(body, 'scrollHeight', { value: 100, configurable: true });
    act(() => {
      TestResizeObserver.instances.forEach((ro) => ro.trigger());
    });
    expect(pop.style.top).toBe('600px');

    // The body grows past what 600px of headroom leaves (wanted = 40 header + 700 body = 740;
    // 800 - 12 - 740 = 48) — top pulls up to fit it instead of staying pinned at the icon.
    Object.defineProperty(body, 'scrollHeight', { value: 700, configurable: true });
    act(() => {
      TestResizeObserver.instances.forEach((ro) => ro.trigger());
    });
    expect(pop.style.top).toBe('48px');
    expect(pop.style.maxHeight).toBe('calc(100vh - 60px)');

    act(() => railRefs.delete('pt-tall-panel'));
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
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

    // table-shell-redesign D1: clears an open, inset-mode sidebar.
    it('shifts right of an inset-mode sidebar, not an overlay-mode one', () => {
      useShell.setState({ openPanel: 'pt-status-left', sidebarOpen: true });
      render(<Popover />);
      expect(screen.getByTestId('popover').style.left).toBe('312px');
      cleanup();

      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: true, media: '', addEventListener() {}, removeEventListener() {} }),
      });
      render(<Popover />);
      expect(screen.getByTestId('popover').style.left).toBe('12px');
      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('returns focus to the scene-name button on close, not a rail icon', () => {
      useShell.setState({ openPanel: 'pt-status-left' });
      const { unmount } = render(<Popover />);
      unmount();
      expect(screen.getByTestId('scene-name').focus).toHaveBeenCalled();
    });

    // M3 review finding 15: the Session popover (a `status-left` panel) did not move focus in
    // at all — same fix, same fallback, as the rail-anchored path.
    it('moves focus in on open, same as a rail-anchored popover', async () => {
      useShell.setState({ openPanel: 'pt-status-left' });
      render(<Popover />);
      await nextFrame();
      expect(screen.getByTestId('pt-first-control')).toBe(document.activeElement);
    });
  });
});
