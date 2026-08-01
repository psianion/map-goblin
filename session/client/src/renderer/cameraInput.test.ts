// The camera input layer, pinned without a GPU. Everything here is arithmetic over a bare
// pixi Container plus DOM listeners, so a jsdom container and a fake engine cover the lot.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { useStore } from '@dnd/core/src/store/store';
import type { DungeonLayer } from '@dnd/core/src/store/types';
import { MAX_ZOOM } from './camera';
import { attachCameraInput, fitMap, minZoom, zoomAbout } from './cameraInput';

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

function mount(zoom: number): { stage: Container; engine: RenderEngine } {
  const stage = new Container();
  stage.scale.set(zoom);
  const engine = {
    stage: () => stage,
    viewport: () => VIEWPORT,
  } as unknown as RenderEngine;
  return { stage, engine };
}

/** Where the world point currently under (sx, sy) lives. */
const worldUnder = (stage: Container, sx: number, sy: number) => ({
  x: (sx - stage.position.x) / stage.scale.x,
  y: (sy - stage.position.y) / stage.scale.y,
});

let detach: (() => void) | null = null;
beforeEach(() => {
  useStore.getState().resetToDefault();
});
afterEach(() => {
  detach?.();
  detach = null;
});

/**
 * Put one dungeon layer holding exactly this floor union in the store — the bounds the
 * camera measures against. Set rather than `updateLayer`d: the store re-runs the union on an
 * update and outsets it, and what is under test is what the camera does with a given map.
 */
function setFloor(x0: number, y0: number, x1: number, y1: number): void {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon');
  if (!layer) throw new Error('default state has no dungeon layer');
  useStore.setState({
    layers: [
      {
        ...layer,
        mergedFloor: [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ],
        ],
      },
    ],
  });
}

describe('fitMap', () => {
  it('refuses to frame a document with no geometry in it yet', () => {
    const { stage, engine } = mount(20);
    useStore.setState({ layers: [] });
    // A player seat is handed a document stripped to what it has revealed, and the floor
    // union the bounds are measured from is rebuilt a beat after the document lands. Framing
    // on nothing is what parks a joining player at the default camera over empty space, with
    // a click on a door row as its only way back.
    expect(fitMap(engine)).toBe(false);
    expect(stage.scale.x).toBe(20);
  });

  it('centres a map drawn far from the origin and fits it on screen', () => {
    const { stage, engine } = mount(20);
    setFloor(100, 100, 140, 120);

    expect(fitMap(engine)).toBe(true);
    // The centre of the floor is what the middle of the viewport is looking at. Asserted as
    // a world point rather than a stage offset: the bounds carry a stroke/shadow pad, and
    // what matters is where the map sits, not what the pad measures.
    const centre = worldUnder(stage, 400, 300);
    expect(centre.x).toBeCloseTo(120, 8);
    expect(centre.y).toBeCloseTo(110, 8);
    // …and every corner of it is on screen.
    for (const [x, y] of [
      [100, 100],
      [140, 120],
    ]) {
      const sx = stage.position.x + x * stage.scale.x;
      const sy = stage.position.y + y * stage.scale.y;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(800);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(600);
    }
  });
});

describe('minZoom', () => {
  it('lets a big map be zoomed out until the whole of it fits', () => {
    const { engine } = mount(20);
    setFloor(0, 0, 400, 300);
    const min = minZoom(engine);
    expect(min).toBeLessThan(10);
    // Far enough out to hold the map, and no further than it takes.
    expect(400 * min).toBeLessThanOrEqual(800);
    expect(300 * min).toBeLessThanOrEqual(600);
    expect(min).toBeGreaterThan(1.5);
  });

  it('never locks the camera on a map small enough to fit at any zoom', () => {
    const { engine } = mount(20);
    setFloor(0, 0, 4, 3);
    // Fitting this means zooming past the ceiling; the editor's floor holds instead.
    expect(minZoom(engine)).toBe(10);
  });
});

describe('zoomAbout', () => {
  it('leaves the world point under the cursor exactly where it was', () => {
    const { stage } = mount(20);
    stage.position.set(-140, 60);
    const before = worldUnder(stage, 310, 220);

    zoomAbout(stage, 310, 220, 1.1, 10, MAX_ZOOM);

    expect(stage.scale.x).toBeCloseTo(22, 10);
    const after = worldUnder(stage, 310, 220);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('clamps at both ends instead of running off', () => {
    const { stage } = mount(MAX_ZOOM);
    zoomAbout(stage, 0, 0, 4, 10, MAX_ZOOM);
    expect(stage.scale.x).toBe(MAX_ZOOM);

    stage.scale.set(10);
    zoomAbout(stage, 0, 0, 0.25, 10, MAX_ZOOM);
    expect(stage.scale.x).toBe(10);
  });
});

describe('attachCameraInput', () => {
  it('zooms towards the cursor on a wheel and keeps the page from scrolling', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    detach = attachCameraInput(engine, container);

    const before = worldUnder(stage, 200, 150);
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(stage.scale.x).toBeGreaterThan(20);
    const after = worldUnder(stage, 200, 150);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('zooms out on a wheel the other way', () => {
    const { stage, engine } = mount(40);
    const container = document.createElement('div');
    detach = attachCameraInput(engine, container);

    container.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 100, clientX: 0, clientY: 0, cancelable: true }),
    );
    expect(stage.scale.x).toBeLessThan(40);
  });

  it('zooms about the viewport centre on + and -', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    detach = attachCameraInput(engine, container);

    const before = worldUnder(stage, 400, 300);
    const plus = new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true });
    window.dispatchEvent(plus);

    expect(plus.defaultPrevented).toBe(true);
    expect(stage.scale.x).toBeCloseTo(25, 10);
    const after = worldUnder(stage, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', cancelable: true }));
    expect(stage.scale.x).toBeCloseTo(20, 10);
  });

  it('leaves the keys to whoever is typing', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    detach = attachCameraInput(engine, container);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
    expect(stage.scale.x).toBe(20);
    input.remove();
  });

  it('pans on a drag and stops on release', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    // jsdom has no pointer capture; the pan must not depend on it working.
    container.setPointerCapture = () => {};
    container.hasPointerCapture = () => false;
    detach = attachCameraInput(engine, container);

    const down = (type: string, init: PointerEventInit) =>
      container.dispatchEvent(new MouseEvent(type, init) as unknown as PointerEvent);

    down('pointerdown', { button: 0, clientX: 100, clientY: 100 });
    down('pointermove', { clientX: 130, clientY: 90 });
    expect(stage.position.x).toBe(30);
    expect(stage.position.y).toBe(-10);

    down('pointerup', { clientX: 130, clientY: 90 });
    down('pointermove', { clientX: 500, clientY: 500 });
    expect(stage.position.x).toBe(30);
  });

  it('ignores a right-click drag — that gesture belongs to the browser', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    container.setPointerCapture = () => {};
    container.hasPointerCapture = () => false;
    detach = attachCameraInput(engine, container);

    container.dispatchEvent(
      new MouseEvent('pointerdown', { button: 2, clientX: 100, clientY: 100 }),
    );
    container.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 200 }));
    expect(stage.position.x).toBe(0);
  });

  it('detaches every listener it added', () => {
    const { stage, engine } = mount(20);
    const container = document.createElement('div');
    attachCameraInput(engine, container)();

    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(stage.scale.x).toBe(20);
  });
});
