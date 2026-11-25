import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../../session/store';
import { useAsPlayers } from '../fog/asPlayers';
import { mountLightsEditor } from './LightEditor';
import { useLightSelection } from './selection';

vi.mock('../../renderer/camera', () => ({
  worldToScreen: vi.fn(() => ({ x: 50, y: 50 })),
  frameWorldPoint: vi.fn(),
}));

const layers = [
  {
    id: 'dungeon',
    type: 'dungeon',
    children: [
      {
        id: 'l1',
        name: 'Brazier',
        childType: 'light',
        visible: true,
        color: '#ffffff',
        radius: 5,
        featherRadius: 1,
        intensity: 1,
        falloff: 'linear',
        position: { x: 0, y: 0 },
      } as unknown as LightChild,
    ],
    standaloneWalls: [],
    rooms: [],
  } as unknown as Layer,
];

function harness() {
  useStore.setState({ layers: structuredClone(layers) });
  useSessionStore.setState({ sendCommand });
  useLightSelection.getState().select(null);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const setIconsVisible = vi.fn();
  const stop = mountLightsEditor(
    { canvas: () => canvas, screenToWorld: (x: number, y: number) => ({ x, y }) } as never,
    { lightingRenderer: { setIconsVisible } } as never,
  );
  // Registered *after* the editor, and still on the canvas itself — exactly how `tokens/drag.ts`
  // sits under this: nothing but a capture-phase document listener can get in front of it.
  const under = vi.fn();
  canvas.addEventListener('pointerdown', under, true);
  return { canvas, stop, setIconsVisible, under };
}

const press = (canvas: HTMLElement, x: number, y: number): void => {
  canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: x, clientY: y, bubbles: true }));
};

let sendCommand = vi.fn();
beforeEach(() => {
  sendCommand = vi.fn();
});
afterEach(() => document.body.replaceChildren());

describe('mountLightsEditor', () => {
  it('lets a token under the light take the press (tokens win over lights at the table)', () => {
    const h = harness();
    useSessionStore.setState({
      session: {
        activeSceneId: 'a',
        modules: { tokens: { library: {}, byScene: { a: { t1: { id: 't1', name: 'Ogre', x: 52, y: 50, size: 'medium', z: 0, elevation: 0 } } } } },
      } as never,
    });
    press(h.canvas, 52, 50);
    expect(useLightSelection.getState().selectedId).toBeNull();
    expect(h.under).toHaveBeenCalled();
    useSessionStore.setState({ session: null });
  });

  it('takes the press when it lands on a light — nothing under the icon sees it', () => {
    const h = harness();
    press(h.canvas, 52, 50);
    expect(useLightSelection.getState().selectedId).toBe('l1');
    expect(h.under).not.toHaveBeenCalled();
    h.stop();
  });

  it('lets a press that misses every icon through, and clears nothing of its own', () => {
    const h = harness();
    press(h.canvas, 200, 200);
    expect(useLightSelection.getState().selectedId).toBeNull();
    expect(h.under).toHaveBeenCalled();
    h.stop();
  });

  it('flips the light on a double press, without arming a drag for the second one', () => {
    const h = harness();
    press(h.canvas, 52, 50);
    expect(sendCommand).not.toHaveBeenCalled(); // one press selects, nothing more
    press(h.canvas, 52, 50);
    // A light switches with its group, as one set-lights (a light with no group is the only id).
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-lights', { ids: ['l1'], on: false });
    // The preview lands locally too, so the icon flips before the round trip.
    expect((useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0]!.visible).toBe(false);
    h.stop();
  });

  it('leaves two slow presses as two selections', () => {
    vi.useFakeTimers();
    const h = harness();
    press(h.canvas, 52, 50);
    vi.advanceTimersByTime(400); // past DOUBLE_CLICK_MS
    press(h.canvas, 52, 50);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(useLightSelection.getState().selectedId).toBe('l1');
    h.stop();
    vi.useRealTimers();
  });

  it('shows the icons for as long as the mode is mounted, and drops the selection on the way out', () => {
    const h = harness();
    expect(h.setIconsVisible).toHaveBeenCalledWith(true);
    press(h.canvas, 50, 50);
    h.stop();
    expect(h.setIconsVisible).toHaveBeenLastCalledWith(false);
    expect(useLightSelection.getState().selectedId).toBeNull();
    press(h.canvas, 50, 50); // torn down: no listener left to answer it
    expect(useLightSelection.getState().selectedId).toBeNull();
  });

  it('hides the icons while the DM looks as players see it, and a press there finds no light', () => {
    const h = harness();
    useAsPlayers.getState().set(true);
    expect(h.setIconsVisible).toHaveBeenLastCalledWith(false);
    press(h.canvas, 52, 50);
    expect(useLightSelection.getState().selectedId).toBeNull();
    expect(h.under).toHaveBeenCalled();
    useAsPlayers.getState().set(false);
    expect(h.setIconsVisible).toHaveBeenLastCalledWith(true);
    h.stop();
  });
});

describe('mountLightsEditor: a light fixed to a prop', () => {
  it('does not drag at the table: nothing moves and no set-light goes out', () => {
    const h = harness();
    useStore.setState((s) => {
      ((s.layers[0] as unknown as { children: LightChild[] }).children[0]!).attachedTo = 'brazier-prop';
    });
    press(h.canvas, 52, 50);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 90 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 120, clientY: 90 }));
    expect(sendCommand).not.toHaveBeenCalled();
    expect((useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0]!.position).toEqual({ x: 0, y: 0 });
    h.stop();
  });
});
