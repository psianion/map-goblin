// Double-click over a light or a door flips it instead of dropping into node editing.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dnd/ui/toast', () => ({ notify: { info: vi.fn() } }));

import { notify } from '@dnd/ui/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import type { DungeonLayer } from '@/store/types';
import type { AssetChild, DoorChild, LightChild } from '@dnd/core/src/shared/types';
import { toggleFixtureAt } from './doubleClickToggle';

function makeLight(overrides?: Partial<LightChild>): LightChild {
  return {
    id: 'light-1',
    name: 'Light',
    childType: 'light',
    visible: true,
    position: { x: 2, y: 2 },
    radius: 5,
    color: '#ffbb66',
    intensity: 1,
    falloff: 'quadratic',
    ...overrides,
  } as LightChild;
}

function makeDoor(overrides?: Partial<DoorChild>): DoorChild {
  return {
    id: 'door-1',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: '',
    position: [10, 10],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...overrides,
  };
}

function seed(children: (LightChild | DoorChild | AssetChild)[], patch?: Partial<DungeonLayer>): DungeonLayer {
  const layer = { ...createDungeonLayer('L'), children, ...patch } as DungeonLayer;
  useStore.setState((s) => {
    s.layers = [layer];
  });
  return layer;
}

function child(id: string): LightChild | DoorChild {
  const layer = useStore.getState().layers[0] as DungeonLayer;
  return layer.children.find((c) => c.id === id) as LightChild | DoorChild;
}

describe('toggleFixtureAt', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('turns a light off, and undo puts it back', () => {
    seed([makeLight()]);

    expect(toggleFixtureAt({ x: 2, y: 2 }, 1)).toBe(true);
    expect((child('light-1') as LightChild).visible).toBe(false);

    undoManager.undo();
    expect((child('light-1') as LightChild).visible).toBe(true);
  });

  it('turns a hidden light back on', () => {
    seed([makeLight({ visible: false })]);

    expect(toggleFixtureAt({ x: 2, y: 2 }, 1)).toBe(true);
    expect((child('light-1') as LightChild).visible).toBe(true);
  });

  it('swings a closed door open and an open one shut', () => {
    seed([makeDoor()]);

    expect(toggleFixtureAt({ x: 10, y: 10 }, 1)).toBe(true);
    expect((child('door-1') as DoorChild).state).toBe('open');

    expect(toggleFixtureAt({ x: 10, y: 10 }, 1)).toBe(true);
    expect((child('door-1') as DoorChild).state).toBe('closed');
  });

  it('leaves a locked door locked, and an archway alone, but still claims the click', () => {
    seed([makeDoor({ id: 'locked', state: 'locked' }), makeDoor({ id: 'arch', style: 'archway', position: [20, 20] })]);

    expect(toggleFixtureAt({ x: 10, y: 10 }, 1)).toBe(true);
    expect((child('locked') as DoorChild).state).toBe('locked');
    expect(notify.info).toHaveBeenCalledWith('Locked — unlock it in the door card');

    expect(toggleFixtureAt({ x: 20, y: 20 }, 1)).toBe(true);
    expect((child('arch') as DoorChild).state).toBe('closed');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('claims nothing when the click missed', () => {
    seed([makeDoor()]);
    expect(toggleFixtureAt({ x: 40, y: 40 }, 1)).toBe(false);
  });

  it('claims nothing on a locked layer — the hit test skips it, so node editing still gets the click', () => {
    seed([makeDoor()], { locked: true });
    expect(toggleFixtureAt({ x: 10, y: 10 }, 1)).toBe(false);
    expect((child('door-1') as DoorChild).state).toBe('closed');
  });

  describe('a light prop', () => {
    const prop = (over: Partial<AssetChild> = {}): AssetChild => ({
      id: 'candle',
      name: 'Candle',
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: 'gg-demo:light_candle_large_lit_1x1_object_A',
      position: { x: 30, y: 30 },
      rotation: 0,
      scale: 1,
      width: 2,
      height: 2,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
      ...over,
    });
    // At zoom 100 a light's icon is a few hundredths of a cell, so a click on the prop's edge
    // lands on the prop, not on the light at its centre.
    const ZOOM = 100;

    it('switches its attached lights, with their group, as one undo step', () => {
      seed([
        prop(),
        makeLight({ id: 'flame', attachedTo: 'candle', position: { x: 30, y: 30 }, group: 'Hall' }),
        makeLight({ id: 'mate', position: { x: 2, y: 2 }, group: 'Hall' }),
      ]);
      expect(toggleFixtureAt({ x: 30.8, y: 30.8 }, ZOOM)).toBe(true);
      expect((child('flame') as LightChild).visible).toBe(false);
      expect((child('mate') as LightChild).visible).toBe(false);
      undoManager.undo();
      expect((child('flame') as LightChild).visible).toBe(true);
      expect((child('mate') as LightChild).visible).toBe(true);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('leaves a locked prop`s light alone', () => {
      seed([prop({ locked: true }), makeLight({ id: 'flame', attachedTo: 'candle', position: { x: 30, y: 30 } })]);
      toggleFixtureAt({ x: 30.8, y: 30.8 }, ZOOM);
      expect((child('flame') as LightChild).visible).toBe(true);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('leaves a prop with no light to whatever double-click did before', () => {
      seed([prop()]);
      expect(toggleFixtureAt({ x: 30.8, y: 30.8 }, ZOOM)).toBe(false);
    });
  });
});
