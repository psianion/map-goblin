import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { PresetApplyCommand, PropertyCommand, ShapeStyleCommand } from './commands';
import { DUNGEON_STYLE_PRESETS } from './presetRegistry';
import type { ShapeChild } from '@/shared/types';
import type { DungeonLayer } from './types';

describe('PropertyCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('execute applies after values via updateLayer', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');
    expect(layer.locked).toBe(false);

    const cmd = new PropertyCommand(
      'Lock layer',
      { type: 'layer', layerId: layer.id },
      { locked: false },
      { locked: true },
    );
    cmd.execute();

    const updated = useStore.getState().layers.find((l) => l.id === layer.id);
    expect(updated?.locked).toBe(true);
  });

  it('undo applies before values via updateLayer', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');

    const cmd = new PropertyCommand(
      'Lock layer',
      { type: 'layer', layerId: layer.id },
      { locked: false },
      { locked: true },
    );
    cmd.execute();
    cmd.undo();

    const restored = useStore.getState().layers.find((l) => l.id === layer.id);
    expect(restored?.locked).toBe(false);
  });

  it('execute/undo with type child uses updateChild', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');

    const shape: ShapeChild = {
      id: 'prop-test-child',
      name: 'Prop Test',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    };
    useStore.getState().addChild(layer.id, shape);

    const cmd = new PropertyCommand(
      'Hide child',
      { type: 'child', layerId: layer.id, childId: shape.id },
      { visible: true },
      { visible: false },
    );
    cmd.execute();

    const afterExec = useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer;
    const childAfter = afterExec.children.find((c) => c.id === shape.id);
    expect(childAfter?.visible).toBe(false);

    cmd.undo();

    const afterUndo = useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer;
    const childRestored = afterUndo.children.find((c) => c.id === shape.id);
    expect(childRestored?.visible).toBe(true);
  });

  it('execute applies visibility change via updateLayer', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');
    expect(layer.visible).toBe(true);

    const cmd = new PropertyCommand(
      'Hide layer',
      { type: 'layer', layerId: layer.id },
      { visible: true },
      { visible: false },
    );
    cmd.execute();

    const updated = useStore.getState().layers.find((l) => l.id === layer.id);
    expect(updated?.visible).toBe(false);
  });
});

describe('PresetApplyCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('execute applies preset style to layer', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
    const preset = DUNGEON_STYLE_PRESETS[0];
    const prevStyle = structuredClone(layer.style);
    const cmd = new PresetApplyCommand('test', layer.id, preset, prevStyle);
    cmd.execute();
    const updated = useStore.getState().layers.find((l) => l.id === layer.id);
    if (!updated || updated.type !== 'dungeon') throw new Error('Layer gone');
    expect(updated.style.floorColor).toBe(preset.dungeonStyle.floorColor);
  });

  it('undo restores previous style', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
    const preset = DUNGEON_STYLE_PRESETS[0];
    const prevStyle = structuredClone(layer.style);
    const cmd = new PresetApplyCommand('test', layer.id, preset, prevStyle);
    cmd.execute();
    cmd.undo();
    const restored = useStore.getState().layers.find((l) => l.id === layer.id);
    if (!restored || restored.type !== 'dungeon') throw new Error('Layer gone');
    expect(restored.style.floorColor).toBe(prevStyle.floorColor);
  });
});

describe('ShapeStyleCommand', () => {
  let layerId: string;
  let childId: string;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
    layerId = layer.id;

    const shape: ShapeChild = {
      id: 'test-shape-1',
      name: 'Test Shape',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    };
    useStore.getState().addChild(layerId, shape);
    childId = shape.id;
  });

  it('execute applies styleOverrides to the child', () => {
    const overrides = { floorColor: '#ff0000' };
    const cmd = new ShapeStyleCommand('test', layerId, childId, undefined, overrides);
    cmd.execute();

    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') throw new Error('Layer gone');
    const child = layer.children.find((c) => c.id === childId);
    expect(child?.styleOverrides).toEqual(overrides);
  });

  it('undo restores previous styleOverrides', () => {
    const overrides = { floorColor: '#ff0000' };
    const cmd = new ShapeStyleCommand('test', layerId, childId, undefined, overrides);
    cmd.execute();
    cmd.undo();

    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') throw new Error('Layer gone');
    const child = layer.children.find((c) => c.id === childId);
    expect(child?.styleOverrides).toBeUndefined();
  });

  it('undo restores non-empty previous overrides', () => {
    const prevOverrides = { floorColor: '#aabbcc' };
    const newOverrides = { floorColor: '#ff0000', wallColor: '#00ff00' };
    const cmd = new ShapeStyleCommand('test', layerId, childId, prevOverrides, newOverrides);
    cmd.execute();
    cmd.undo();

    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') throw new Error('Layer gone');
    const child = layer.children.find((c) => c.id === childId);
    expect(child?.styleOverrides).toEqual(prevOverrides);
  });
});
