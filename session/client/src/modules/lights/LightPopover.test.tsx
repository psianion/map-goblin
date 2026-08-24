import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { worldToScreen } from '../../renderer/camera';
import { useSessionStore } from '../../session/store';
import { LightPopover } from './LightPopover';
import { useLightSelection } from './selection';

vi.mock('../../renderer/camera', () => ({
  worldToScreen: vi.fn(),
  frameWorldPoint: vi.fn(),
}));
const screenOf = vi.mocked(worldToScreen);

const light = (over: Partial<LightChild> = {}): LightChild =>
  ({
    id: 'l1',
    name: 'Brazier',
    childType: 'light',
    visible: true,
    color: '#ffbb66',
    radius: 6,
    featherRadius: 3,
    intensity: 0.8,
    falloff: 'quadratic',
    position: { x: 2, y: 3 },
    ...over,
  }) as LightChild;

const dungeonLayer = (children: LightChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

/** The map element `LightPopover` reads for its own bounds — real dimensions, unlike jsdom's
 *  default zeroed `getBoundingClientRect` (same helper `DoorMenu.test.tsx` uses). */
function mountMapElement(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'game-canvas');
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

let sendCommand = vi.fn();

beforeEach(() => {
  cleanup();
  screenOf.mockReset();
  sendCommand = vi.fn();
  useSessionStore.setState({
    mapData: { mapSettings: { cellScale: { value: 5, unit: 'ft' } } },
    sendCommand,
  });
  useStore.setState({ layers: [dungeonLayer([light()])] });
  useLightSelection.setState({ selectedId: null });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('LightPopover', () => {
  it('renders nothing when no light is selected', () => {
    mountMapElement();
    render(<LightPopover />);
    expect(screen.queryByTestId('light-popover')).toBeNull();
  });

  it('renders the selected light’s own values, positioned off its world point', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    expect(screen.getByTestId('light-name').textContent).toBe('Brazier');
    expect(screen.getByTestId('light-visible').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('light-radius-slider')).toHaveProperty('value', '6');
    // 3 of 6 cells is 50% bright zone, at 5ft/cell.
    expect(screen.getByTestId('light-feather-slider')).toHaveProperty('value', '50');
    expect(screen.getByTestId('light-intensity-slider')).toHaveProperty('value', '0.8');
    expect(screen.getByTestId('light-color')).toHaveProperty('value', '#ffbb66');

    const popover = screen.getByTestId('light-popover');
    expect(popover.style.visibility).toBe('visible');
  });

  it('sends set-light with the released radius (and the clamped feather) on slider release', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    const slider = screen.getByTestId('light-radius-slider');
    fireEvent.change(slider, { target: { value: '2' } }); // below the current 3-cell feather
    fireEvent.pointerUp(slider);

    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-light', {
      lightId: 'l1',
      patch: { radius: 2, featherRadius: 2 },
    });
  });

  it('sends set-light for the bright-zone slider on release', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    const slider = screen.getByTestId('light-feather-slider');
    fireEvent.change(slider, { target: { value: '20' } }); // 20% of 6 cells = 1.2
    fireEvent.pointerUp(slider);

    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-light', {
      lightId: 'l1',
      patch: { featherRadius: expect.closeTo(1.2) },
    });
  });

  it('sends set-light for the intensity slider on release', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    const slider = screen.getByTestId('light-intensity-slider');
    fireEvent.change(slider, { target: { value: '0.25' } });
    fireEvent.pointerUp(slider);

    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-light', {
      lightId: 'l1',
      patch: { intensity: 0.25 },
    });
  });

  it('sends the toggle immediately, no release needed', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    fireEvent.click(screen.getByTestId('light-visible'));
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-light', {
      lightId: 'l1',
      patch: { visible: false },
    });
  });

  it('sends set-light for the falloff choice, and shows the light’s own', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    const group = screen.getByTestId('light-falloff');
    expect(group.getAttribute('data-value')).toBe('quadratic');
    fireEvent.click(group.querySelector('[data-value="linear"]')!);

    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-light', {
      lightId: 'l1',
      patch: { falloff: 'linear' },
    });
  });

  it('sends reset-light from the Reset button', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    fireEvent.click(screen.getByTestId('light-reset'));
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'reset-light', { lightId: 'l1' });
  });

  it('closes on a click that lands on the map but hits nothing', () => {
    const map = mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    fireEvent.pointerDown(map);
    expect(useLightSelection.getState().selectedId).toBeNull();
  });

  it('does not close on a click inside the popover itself', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);

    fireEvent.pointerDown(screen.getByTestId('light-popover'));
    expect(useLightSelection.getState().selectedId).toBe('l1');
  });

  it('stops a pointerdown and a wheel from reaching the map underneath it', () => {
    mountMapElement();
    screenOf.mockReturnValue({ x: 100, y: 50 });
    useLightSelection.getState().select('l1');
    render(<LightPopover />);
    const popover = screen.getByTestId('light-popover');

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    const downSpy = vi.spyOn(down, 'stopPropagation');
    popover.dispatchEvent(down);
    expect(downSpy).toHaveBeenCalled();

    const wheel = new Event('wheel', { bubbles: true, cancelable: true });
    const wheelSpy = vi.spyOn(wheel, 'stopPropagation');
    popover.dispatchEvent(wheel);
    expect(wheelSpy).toHaveBeenCalled();
  });
});
