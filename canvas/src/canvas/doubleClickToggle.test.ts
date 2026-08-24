// Double-click over a light or a door flips it instead of dropping into node editing.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import type { DungeonLayer } from '@/store/types';
import type { DoorChild, LightChild } from '@dnd/core/src/shared/types';
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

function seed(children: (LightChild | DoorChild)[], patch?: Partial<DungeonLayer>): DungeonLayer {
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
});
