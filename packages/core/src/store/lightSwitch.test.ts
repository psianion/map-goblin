import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import {
  clampLightPatch,
  setLightStateCommand,
  switchRoomCommand,
  toggleLightCommand,
  toggleLightsOnPropCommand,
} from './lightCommands';
import type { AssetChild, LightChild } from '../shared/types';
import type { DungeonLayer } from './types';
import { createDungeonLayer } from './factories';
import { createDuplicateCommand } from './propEdits';

const light = (id: string, over: Partial<LightChild> = {}): LightChild => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffb561',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 5, y: 5 },
  ...over,
});

const prop = (id: string): AssetChild => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'gg-demo:light_brazier_1_c_1x1_object_A',
  position: { x: 5, y: 5 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
});

let layerId = '';
const get = (id: string): LightChild =>
  (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer).children.find((c) => c.id === id) as LightChild;
const run = (cmd: ReturnType<typeof toggleLightCommand>) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
  return cmd!;
};

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
  const s = useStore.getState();
  s.addChild(layerId, prop('brazier'));
  s.addChild(layerId, light('a', { group: 'Hall sconces' }));
  s.addChild(layerId, light('b', { group: 'Hall sconces' }));
  s.addChild(layerId, light('c', { group: 'Hall sconces', locked: true }));
  s.addChild(layerId, light('d'));
  s.addChild(layerId, light('fire', { attachedTo: 'brazier' }));
});

describe('toggleLightCommand', () => {
  it('switches the whole group as one undo step, named after the group, skipping a locked mate', () => {
    const cmd = run(toggleLightCommand('a'));
    expect(cmd.label).toBe('Switch group Hall sconces');
    expect([get('a').visible, get('b').visible, get('c').visible, get('d').visible]).toEqual([false, false, true, true]);
    undoManager.undo();
    expect([get('a').visible, get('b').visible]).toEqual([true, true]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('switches an ungrouped light alone', () => {
    expect(run(toggleLightCommand('d')).label).toBe('Switch light');
    expect([get('a').visible, get('d').visible]).toEqual([true, false]);
  });

  it('brings every mate to the clicked light`s new state rather than flipping each', () => {
    useStore.getState().updateChild(layerId, 'b', { visible: false });
    run(toggleLightCommand('b'));
    expect([get('a').visible, get('b').visible]).toEqual([true, true]);
  });
});

describe('toggleLightsOnPropCommand', () => {
  it('switches a prop`s lights off and on, and is null for a prop with none', () => {
    run(toggleLightsOnPropCommand('brazier'));
    expect(get('fire').visible).toBe(false);
    run(toggleLightsOnPropCommand('brazier'));
    expect(get('fire').visible).toBe(true);
    expect(toggleLightsOnPropCommand('nothing')).toBeNull();
  });

  it('leaves a locked attached light alone, and is null when every attached light is locked', () => {
    useStore.getState().addChild(layerId, light('held', { attachedTo: 'brazier', locked: true }));
    run(toggleLightsOnPropCommand('brazier'));
    expect([get('fire').visible, get('held').visible]).toEqual([false, true]);
    useStore.getState().updateChild(layerId, 'fire', { locked: true });
    expect(toggleLightsOnPropCommand('brazier')).toBeNull();
  });
});

describe('duplicating a grouped light', () => {
  it('puts the copy in the same group on purpose, so the group switch reaches it', () => {
    const { command, newIds } = createDuplicateCommand(useStore.getState().layers, ['a']);
    run(command);
    const copy = get(newIds[0]!);
    expect(copy.group).toBe('Hall sconces');
    run(toggleLightCommand('a'));
    expect(get(newIds[0]!).visible).toBe(false);
  });
});

describe('locks', () => {
  it('a locked light does not toggle, and a mate on a locked layer is not reached', () => {
    expect(toggleLightCommand('c')).toBeNull();
    const locked: DungeonLayer = { ...createDungeonLayer('Upstairs'), locked: true, children: [light('upstairs', { group: 'Hall sconces' })] };
    useStore.setState({ layers: [...useStore.getState().layers, locked] });
    run(toggleLightCommand('a'));
    const up = (useStore.getState().layers.find((l) => l.id === locked.id) as DungeonLayer).children[0] as LightChild;
    expect(get('a').visible).toBe(false);
    expect(up.visible).toBe(true);
  });
});

describe('setLightStateCommand', () => {
  it('sets embers, keeps it through Off, and On clears it', () => {
    run(setLightStateCommand(['fire'], 'embers'));
    expect(get('fire')).toMatchObject({ visible: true, embers: true });
    run(setLightStateCommand(['fire'], 'off'));
    expect(get('fire')).toMatchObject({ visible: false, embers: true });
    // Double-click from Off goes back to whatever it was: embers.
    run(toggleLightsOnPropCommand('brazier'));
    expect(get('fire')).toMatchObject({ visible: true, embers: true });
    run(setLightStateCommand(['fire'], 'on'));
    expect(get('fire').visible).toBe(true);
    expect(get('fire').embers).toBeUndefined();
  });

  it('is null when nothing changes', () => {
    expect(setLightStateCommand(['d'], 'on')).toBeNull();
  });
});

describe('switchRoomCommand', () => {
  beforeEach(() => {
    const layer = useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
    const face: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    useStore.setState({
      layers: useStore.getState().layers.map((l) =>
        l.id === layerId ? { ...layer, rooms: [{ id: 'hall', name: 'Hall', anchor: [5, 5], face }] } : l,
      ),
    });
  });

  it('switches the room`s unlocked lights as one step named by the count', () => {
    const cmd = run(switchRoomCommand('hall', false));
    expect(cmd.label).toBe('Switch room 4 lights');
    expect([get('a'), get('b'), get('c'), get('d'), get('fire')].map((l) => l.visible)).toEqual([false, false, true, false, false]);
    undoManager.undo();
    expect([get('a'), get('d'), get('fire')].every((l) => l.visible)).toBe(true);
  });

  it('counts a group mate outside the room that follows, in the label', () => {
    useStore.getState().addChild(layerId, light('far', { group: 'Hall sconces', position: { x: 50, y: 50 } }));
    const cmd = run(switchRoomCommand('hall', false));
    expect(cmd.label).toBe('Switch room 5 lights');
    expect(get('far').visible).toBe(false);
  });

  it('is null for a room with no lights or an unknown room', () => {
    expect(switchRoomCommand('nope', false)).toBeNull();
  });
});

describe('clampLightPatch: motion and group', () => {
  it('holds speeds in range, wraps sweep edges and trims the group name', () => {
    const l = light('x');
    expect(clampLightPatch(l, { motion: { kind: 'spin', rpm: 90, clockwise: true } }).motion).toEqual({ kind: 'spin', rpm: 30, clockwise: true });
    expect(clampLightPatch(l, { motion: { kind: 'sweep', from: -90, to: 450, degPerSec: 1 } }).motion).toEqual({
      kind: 'sweep',
      from: 270,
      to: 90,
      degPerSec: 5,
    });
    expect(clampLightPatch(l, { group: '  Hall  ' }).group).toBe('Hall');
    expect(clampLightPatch(l, { group: '   ' }).group).toBeUndefined();
  });
});
