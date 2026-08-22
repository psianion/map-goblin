import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { Token } from '@dnd/mechanics/tokens';
import { worldToScreen } from '../../renderer/camera';
import { useShell } from '../../shell/shellStore';
import { useSessionStore } from '../../session/store';
import { useTokenInteraction } from './drag';
import { TokenMenu } from './TokenMenu';

vi.mock('../../renderer/camera', () => ({
  worldToScreen: vi.fn(),
  frameWorldPoint: vi.fn(),
}));
const screenOf = vi.mocked(worldToScreen);

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Goblin Boss',
  imageAssetId: null,
  size: 'medium',
  disposition: 'hostile',
  sight: null,
  light: null,
  defId: null,
  x: 0.5,
  y: 0.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: null,
  ...over,
});

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p-1', name: 'Borin', role: 'player', connected: true };

function session(tokens: Token[]): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [dm, player],
    modules: { tokens: { library: {}, byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } } },
  };
}

/** The map element `TokenMenu` reads for its own bounds — real dimensions, unlike jsdom's
 *  default zeroed `getBoundingClientRect`. */
function mountMapElement(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'game-canvas');
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  cleanup();
  screenOf.mockReset();
  useTokenInteraction.setState({ selectedId: null, placingDefId: null, draggingId: null });
  useShell.setState({ openPanel: null });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TokenMenu', () => {
  it('renders nothing when no token is selected', () => {
    mountMapElement();
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    render(<TokenMenu />);
    expect(screen.queryByTestId('token-menu')).toBeNull();
  });

  it('guards a stale selection — a token id no longer on this scene', () => {
    mountMapElement();
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('gone');
    render(<TokenMenu />);
    expect(screen.queryByTestId('token-menu')).toBeNull();
  });

  it('shows the token’s name and meta, positioned off its world point', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('t1');
    render(<TokenMenu />);

    const menu = screen.getByTestId('token-menu');
    expect(menu.textContent).toContain('Goblin Boss');
    // Labelled, not the raw enum (finding 16): "Medium", disposition as the coloured dot.
    expect(menu.textContent).toContain('Medium');
    expect(menu.textContent).not.toContain('medium');
    expect(menu.textContent).not.toContain('hostile');
    expect(menu.querySelector('.bg-danger')).not.toBeNull(); // DOT_CLASS.hostile
    // 12px right of the token, vertically centred, clamped inside the 800x600 map — the
    // fallback size (jsdom never lays anything out, so offsetWidth/offsetHeight are 0).
    expect(menu.style.left).toBe('112px');
    expect(menu.style.top).toBe('12px');
    expect(menu.style.visibility).toBe('visible');
  });

  it('hides while a drag on this token is in progress', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.setState({ selectedId: 't1', draggingId: 't1' });
    render(<TokenMenu />);
    expect(screen.queryByTestId('token-menu')).toBeNull();
  });

  it('hides while the Tokens popover is open', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('t1');
    useShell.setState({ openPanel: 'tokens' });
    render(<TokenMenu />);
    expect(screen.queryByTestId('token-menu')).toBeNull();
  });

  // Escape is `hotkeys.ts`'s job now (M3 review finding 12) — see `shell/hotkeys.test.ts`.

  it('closes on a click that lands on the map but hits nothing, not on a click inside itself', () => {
    const map = mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('t1');
    render(<TokenMenu />);

    fireEvent.pointerDown(screen.getByTestId('token-menu'));
    expect(useTokenInteraction.getState().selectedId).toBe('t1');

    fireEvent.pointerDown(map);
    expect(useTokenInteraction.getState().selectedId).toBeNull();
  });

  it('stops a pointerdown and a wheel from reaching the map underneath it', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('t1');
    render(<TokenMenu />);
    const menu = screen.getByTestId('token-menu');

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    const downSpy = vi.spyOn(down, 'stopPropagation');
    menu.dispatchEvent(down);
    expect(downSpy).toHaveBeenCalled();

    const wheel = new Event('wheel', { bubbles: true, cancelable: true });
    const wheelSpy = vi.spyOn(wheel, 'stopPropagation');
    menu.dispatchEvent(wheel);
    expect(wheelSpy).toHaveBeenCalled();
  });

  describe('DM actions', () => {
    beforeEach(() => {
      mountMapElement();
      screenOf.mockReturnValue({ x: 100, y: 50 });
    });

    it('toggles hide/reveal', () => {
      const sent: { action: string; payload: unknown }[] = [];
      useSessionStore.setState({
        session: session([token()]),
        you: dm,
        lastError: null,
        client: { send: (m: { module: string; action: string; payload: unknown }) => sent.push(m) } as never,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);

      fireEvent.click(screen.getByTestId('token-menu-hide'));
      expect(sent[0]).toMatchObject({ action: 'hide', payload: { id: 't1', hidden: true } });
    });

    it('deletes from behind the more menu, and clears the selection', () => {
      const sent: { action: string; payload: unknown }[] = [];
      useSessionStore.setState({
        session: session([token()]),
        you: dm,
        lastError: null,
        client: { send: (m: { module: string; action: string; payload: unknown }) => sent.push(m) } as never,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);

      expect(screen.queryByTestId('token-menu-delete')).toBeNull();
      fireEvent.click(screen.getByTestId('token-menu-more'));
      fireEvent.click(screen.getByTestId('token-menu-delete'));

      expect(sent[0]).toMatchObject({ action: 'delete', payload: { id: 't1' } });
      expect(useTokenInteraction.getState().selectedId).toBeNull();
    });

    it('never offers a Claim button', () => {
      useSessionStore.setState({ session: session([token({ ownerId: null })]), you: dm, client: null, lastError: null });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);
      expect(screen.queryByTestId('token-menu-claim')).toBeNull();
    });
  });

  describe('player actions', () => {
    beforeEach(() => {
      mountMapElement();
      screenOf.mockReturnValue({ x: 100, y: 50 });
    });

    it('offers Claim on an unclaimed token', () => {
      const sent: { action: string; payload: unknown }[] = [];
      useSessionStore.setState({
        session: session([token({ ownerId: null })]),
        you: player,
        lastError: null,
        client: { send: (m: { module: string; action: string; payload: unknown }) => sent.push(m) } as never,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);

      fireEvent.click(screen.getByTestId('token-menu-claim'));
      expect(sent[0]).toMatchObject({ action: 'claim', payload: { id: 't1' } });
    });

    it('offers nothing at all once the token is claimed', () => {
      useSessionStore.setState({
        session: session([token({ ownerId: 'p-1' })]),
        you: player,
        client: null,
        lastError: null,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);

      const menu = screen.getByTestId('token-menu');
      expect(menu.querySelector('button')).toBeNull();
    });

    it('never sees Hide, Frame or the more menu', () => {
      useSessionStore.setState({
        session: session([token({ ownerId: null })]),
        you: player,
        client: null,
        lastError: null,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);
      expect(screen.queryByTestId('token-menu-hide')).toBeNull();
      expect(screen.queryByTestId('token-menu-frame')).toBeNull();
      expect(screen.queryByTestId('token-menu-more')).toBeNull();
    });

    // M3 review finding 8 — the reason used to arrive only as a toast, behind an empty menu.
    it('names the owner instead of an empty menu on someone else’s claimed token', () => {
      useSessionStore.setState({
        session: session([token({ ownerId: 'dm-1' })]),
        you: player,
        client: null,
        lastError: null,
      });
      useTokenInteraction.getState().select('t1');
      render(<TokenMenu />);

      const menu = screen.getByTestId('token-menu');
      expect(menu.textContent).toContain('Held by Ayla');
      expect(menu.querySelector('button')).toBeNull();
    });
  });

  // The plain button row is a group of actions, not a keyboard-navigable menu — this
  // component never implements arrow-key traversal, so `role="menu"` overclaimed semantics
  // (M3 review finding 8).
  it('exposes the whole card as a group, not a menu', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useSessionStore.setState({ session: session([token()]), you: dm, client: null, lastError: null });
    useTokenInteraction.getState().select('t1');
    render(<TokenMenu />);
    expect(screen.getByTestId('token-menu').getAttribute('role')).toBe('group');
  });
});
