import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { worldToScreen } from '../../renderer/camera';
import { useShell } from '../../shell/shellStore';
import { useSessionStore } from '../../session/store';
import { DoorMenu } from './DoorMenu';
import { useDoorSelection } from './selection';

vi.mock('../../renderer/camera', () => ({
  worldToScreen: vi.fn(),
  frameWorldPoint: vi.fn(),
}));
const screenOf = vi.mocked(worldToScreen);

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'd1',
    name: 'Vestry Door',
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

const dungeonLayer = (children: DoorChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };

function session(): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [dm],
    modules: {},
  };
}

/** The map element `DoorMenu` reads for its own bounds — real dimensions, unlike jsdom's
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
  useSessionStore.setState({ session: session(), you: dm, client: null, lastError: null });
  useStore.setState({ layers: [dungeonLayer([door()])] });
  useDoorSelection.setState({ selectedId: null, filter: '' });
  useShell.setState({ openPanel: null });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DoorMenu', () => {
  it('renders nothing when no door is selected', () => {
    mountMapElement();
    render(<DoorMenu />);
    expect(screen.queryByTestId('door-menu')).toBeNull();
  });

  it('guards a stale selection — a door id that is no longer in this seat’s list', () => {
    mountMapElement();
    useDoorSelection.getState().select('gone');
    render(<DoorMenu />);
    expect(screen.queryByTestId('door-menu')).toBeNull();
  });

  it('shows the door’s name, state and actions, positioned off its world point', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    render(<DoorMenu />);

    const menu = screen.getByTestId('door-menu');
    expect(menu.textContent).toContain('Vestry Door');
    expect(menu.textContent).toContain('Closed');
    expect(screen.getByTestId('door-toggle')).not.toBeNull();
    expect(screen.getByTestId('door-lock')).not.toBeNull();

    // 12px right of the door, vertically centred on it, clamped inside the 800x600 map — the
    // fallback size (jsdom never lays anything out, so offsetWidth/offsetHeight are 0).
    expect(menu.style.left).toBe('112px');
    expect(menu.style.top).toBe('12px');
    expect(menu.style.visibility).toBe('visible');
  });

  it('hides itself while the popover is open and already showing this door’s chip', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    useShell.setState({ openPanel: 'doors' });
    render(<DoorMenu />);
    expect(screen.queryByTestId('door-menu')).toBeNull();
  });

  it('still shows itself when the popover is open but has filtered this door’s chip away', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.setState({ selectedId: 'd1', filter: 'no match' });
    useShell.setState({ openPanel: 'doors' });
    render(<DoorMenu />);
    expect(screen.getByTestId('door-menu')).not.toBeNull();
  });

  // Escape is `hotkeys.ts`'s job now (M3 review finding 12) — see `shell/hotkeys.test.ts`.

  it('closes on a click that lands on the map but hits nothing', () => {
    const map = mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    render(<DoorMenu />);

    fireEvent.pointerDown(map);
    expect(useDoorSelection.getState().selectedId).toBeNull();
  });

  /**
   * Token input claims a placement or a grab on the map with `stopImmediatePropagation`
   * (tokens/drag.ts). The menu has to close on those presses too — it listens in the capture
   * phase so it hears them first — or placing a token leaves the menu up, over the map.
   */
  it('closes on a press the token layer claims before it bubbles', () => {
    const map = mountMapElement();
    map.addEventListener('pointerdown', (e) => e.stopImmediatePropagation(), true);
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    render(<DoorMenu />);

    fireEvent.pointerDown(map);
    expect(useDoorSelection.getState().selectedId).toBeNull();
  });

  it('does not close on a click inside the menu itself', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    render(<DoorMenu />);

    fireEvent.pointerDown(screen.getByTestId('door-menu'));
    expect(useDoorSelection.getState().selectedId).toBe('d1');
  });

  it('stops a pointerdown and a wheel from reaching the map underneath it', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useDoorSelection.getState().select('d1');
    render(<DoorMenu />);
    const menu = screen.getByTestId('door-menu');

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    const downSpy = vi.spyOn(down, 'stopPropagation');
    menu.dispatchEvent(down);
    expect(downSpy).toHaveBeenCalled();

    const wheel = new Event('wheel', { bubbles: true, cancelable: true });
    const wheelSpy = vi.spyOn(wheel, 'stopPropagation');
    menu.dispatchEvent(wheel);
    expect(wheelSpy).toHaveBeenCalled();
  });
});
