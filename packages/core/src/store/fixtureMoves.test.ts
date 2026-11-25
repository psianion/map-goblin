// A light attached to a prop is fixed to it: every way of moving, turning, flipping or sizing the
// prop carries the light, its offset turned and mirrored with the prop; a group never moves.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import { createChildRemovalCommand } from './commands';
import { createDuplicateCommand, createMoveToLayerCommand, createPropBoxCommand } from './propEdits';
import { renameGroupCommand, toggleLightCommand } from './lightCommands';
import {
  alignTargetsCommand,
  buildTargets,
  createNudgeCommand,
  distributeTargetsCommand,
  flipCommand,
  rotate90Command,
} from '../engine/transformTargets';
import type { AssetChild, LightChild } from '../shared/types';
import type { Command, DungeonLayer } from './types';

let layerId = '';

const prop = (id: string, x: number, y: number): AssetChild => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'lamp',
  position: { x, y },
  rotation: 0,
  scale: 1,
  width: 2,
  height: 2,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
});

const light = (id: string, x: number, y: number, over: Partial<LightChild> = {}): LightChild => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffcc66',
  radius: 4,
  featherRadius: 2,
  intensity: 0.8,
  falloff: 'quadratic',
  position: { x, y },
  ...over,
});

const all = () => useStore.getState().layers.flatMap((l) => (l.type === 'dungeon' ? l.children : []));
const get = <T>(id: string) => all().find((c) => c.id === id) as T;
const pos = (id: string) => get<LightChild | AssetChild>(id).position;
const run = (cmd: Command | null) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};
const targets = (ids: string[]) => buildTargets(useStore.getState(), ids).targets;

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
  const s = useStore.getState();
  s.addChild(layerId, prop('torch', 5, 5));
  // Off the centre: a torch's flame sits up and to the right of its bracket.
  s.addChild(layerId, light('flame', 5.5, 4.5, { attachedTo: 'torch', group: 'Hall' }));
  s.addChild(layerId, prop('other', 20, 10));
  s.addChild(layerId, light('mate', 30, 30, { group: 'Hall' }));
});

describe('a prop carries its attached light', () => {
  it('through a nudge', () => {
    run(createNudgeCommand(useStore.getState(), ['torch'], 1, 0).command);
    expect(pos('flame')).toEqual({ x: 6.5, y: 4.5 });
  });

  it('through a quarter turn, the offset turned with it', () => {
    run(rotate90Command(targets(['torch'])));
    const p = pos('flame');
    expect(p.x).toBeCloseTo(5.5);
    expect(p.y).toBeCloseTo(5.5);
  });

  it('through a flip, the offset mirrored', () => {
    run(flipCommand(targets(['torch']), 'h'));
    const p = pos('flame');
    expect(p.x).toBeCloseTo(4.5);
    expect(p.y).toBeCloseTo(4.5);
  });

  it('through a resize from the card, the offset scaled', () => {
    run(createPropBoxCommand(['torch'], { x: 5, y: 5, w: 2, h: 2, angle: 0 }, { x: 5, y: 5, w: 4, h: 4, angle: 0 }));
    const p = pos('flame');
    expect(p.x).toBeCloseTo(6);
    expect(p.y).toBeCloseTo(4);
  });

  it('through align and distribute', () => {
    run(alignTargetsCommand(targets(['torch', 'other']), 'bottom'));
    expect(pos('torch').y).toBeCloseTo(10);
    expect(pos('flame').y).toBeCloseTo(9.5);
    useStore.getState().addChild(layerId, prop('third', 40, 5));
    run(distributeTargetsCommand(targets(['torch', 'other', 'third']), 'h'));
    expect(pos('flame').x - pos('torch').x).toBeCloseTo(0.5);
  });

  it('to another layer, and on a paste or duplicate offset, keeping its group', () => {
    const upper = createDungeonLayer('Upper', (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer).levelId);
    useStore.getState().addLayer(upper);
    run(createMoveToLayerCommand(['torch'], upper.id));
    const on = (useStore.getState().layers.find((l) => l.id === upper.id) as DungeonLayer).children.map((c) => c.id);
    expect(on).toEqual(expect.arrayContaining(['torch', 'flame']));

    const { command, newIds } = createDuplicateCommand(useStore.getState().layers, ['torch']);
    run(command);
    const copyProp = all().find((c) => c.id === newIds[0]) as AssetChild;
    const copyLight = all().find((c) => c.childType === 'light' && c.attachedTo === copyProp.id) as LightChild;
    expect(copyLight.position.x - copyProp.position.x).toBeCloseTo(0.5);
    expect(copyLight.group).toBe('Hall');
  });

  it('a group never moves: nudging one member leaves its mates where they are', () => {
    run(createNudgeCommand(useStore.getState(), ['torch'], 1, 1).command);
    expect(pos('mate')).toEqual({ x: 30, y: 30 });
  });

  it('the arrows move an attached light alone, still attached: its spot on the prop changes', () => {
    run(createNudgeCommand(useStore.getState(), ['flame'], 0.25, 0).command);
    expect(pos('flame')).toEqual({ x: 5.75, y: 4.5 });
    expect(pos('torch')).toEqual({ x: 5, y: 5 });
    expect(get<LightChild>('flame').attachedTo).toBe('torch');
  });

  it('a prop and its light picked together move once', () => {
    run(createNudgeCommand(useStore.getState(), ['torch', 'flame'], 1, 0).command);
    expect(pos('flame')).toEqual({ x: 6.5, y: 4.5 });
  });
});

describe('deleting', () => {
  it('a prop deletes its light, and undo brings both back, attached and grouped', () => {
    run(createChildRemovalCommand(layerId, 'torch'));
    expect(get('flame')).toBeUndefined();
    undoManager.undo();
    expect(get<LightChild>('flame')).toMatchObject({ attachedTo: 'torch', group: 'Hall' });
    expect(get('torch')).toBeDefined();
  });

  it('an attached light leaves its prop where it is', () => {
    run(createChildRemovalCommand(layerId, 'flame'));
    expect(get('torch')).toBeDefined();
    expect(get('flame')).toBeUndefined();
  });
});

describe('renameGroupCommand', () => {
  it('renames every member in one step, and the switch still reaches them all', () => {
    const cmd = renameGroupCommand('Hall', 'East hall');
    run(cmd);
    expect(cmd!.label).toBe('Rename group Hall to East hall');
    expect([get<LightChild>('flame').group, get<LightChild>('mate').group]).toEqual(['East hall', 'East hall']);
    run(toggleLightCommand('mate'));
    expect(get<LightChild>('flame').visible).toBe(false);
    undoManager.undo();
    undoManager.undo();
    expect(get<LightChild>('mate').group).toBe('Hall');
  });

  it('is null for an empty or unchanged name', () => {
    expect(renameGroupCommand('Hall', '  ')).toBeNull();
    expect(renameGroupCommand('Hall', 'Hall')).toBeNull();
  });
});
