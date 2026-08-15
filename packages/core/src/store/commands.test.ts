import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { AddChildCommand, PresetApplyCommand, PropertyCommand, RemoveChildCommand, ReorderChildCommand, SetAmbientLightCommand, SetEnvironmentSettingsCommand, ShapeStyleCommand, UpdateChildCommand } from './commands';
import { undoManager } from './undoManager';
import { DUNGEON_STYLE_PRESETS } from './presetRegistry';
import { resolveStyle } from '../engine/styleResolver';
import type { DoorChild, ShapeChild, WallSegment, ZoneChild } from '../shared/types';
import type { DungeonLayer, DungeonStyle } from './types';

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

  // F10 (NIT-11): renaming stays allowed on a locked layer — it's metadata,
  // not geometry, matching Hide/Show (also unguarded) on a locked layer.
  // LayerRow/ChildRow's rename path goes straight through PropertyCommand/
  // UpdateChildCommand with no blockedLayerReason check, unlike delete and
  // duplicate — this documents that as a deliberate decision, not a gap.
  it('renaming a locked layer succeeds — rename is metadata, not a geometry edit', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');
    state.updateLayer(layer.id, { locked: true });

    const cmd = new PropertyCommand(
      'Rename layer',
      { type: 'layer', layerId: layer.id },
      { name: layer.name },
      { name: 'New name' },
    );
    cmd.execute();

    const renamed = useStore.getState().layers.find((l) => l.id === layer.id);
    expect(renamed?.locked).toBe(true);
    expect(renamed?.name).toBe('New name');
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

describe('ReorderChildCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  function makeShape(id: string): ShapeChild {
    return {
      id,
      name: id,
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
  }

  it('execute moves the child from fromIndex to toIndex', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    state.addChild(layer.id, makeShape('c1'));
    state.addChild(layer.id, makeShape('c2'));
    state.addChild(layer.id, makeShape('c3'));

    new ReorderChildCommand('Reorder', layer.id, 0, 2).execute();

    const after = useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer;
    expect(after.children.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('undo restores the original order', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    state.addChild(layer.id, makeShape('c1'));
    state.addChild(layer.id, makeShape('c2'));
    state.addChild(layer.id, makeShape('c3'));

    const cmd = new ReorderChildCommand('Reorder', layer.id, 0, 2);
    cmd.execute();
    cmd.undo();

    const after = useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer;
    expect(after.children.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('redo (execute after undo) reapplies the reorder', () => {
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    state.addChild(layer.id, makeShape('c1'));
    state.addChild(layer.id, makeShape('c2'));
    state.addChild(layer.id, makeShape('c3'));

    const cmd = new ReorderChildCommand('Reorder', layer.id, 0, 2);
    cmd.execute();
    cmd.undo();
    cmd.execute();

    const after = useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer;
    expect(after.children.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });
});

describe('SetAmbientLightCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('execute sets the map ambient color', () => {
    const before = useStore.getState().mapSettings.ambientLight;
    new SetAmbientLightCommand(before, '#ff8800').execute();
    expect(useStore.getState().mapSettings.ambientLight).toBe('#ff8800');
  });

  it('undo restores the previous ambient color', () => {
    const before = useStore.getState().mapSettings.ambientLight;
    const cmd = new SetAmbientLightCommand(before, '#ff8800');
    cmd.execute();
    cmd.undo();
    expect(useStore.getState().mapSettings.ambientLight).toBe(before);
  });
});

describe('SetEnvironmentSettingsCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('patches only the fields it names, and undo puts every one of them back', () => {
    useStore.getState().setEnvironmentSettings({ orientation: 45 });
    const cmd = new SetEnvironmentSettingsCommand(
      { environment: undefined, orientation: 45 },
      { environment: 'outdoor', orientation: 90 },
    );
    cmd.execute();
    expect(useStore.getState().mapSettings).toMatchObject({ environment: 'outdoor', orientation: 90 });
    cmd.undo();
    expect(useStore.getState().mapSettings.orientation).toBe(45);
    // Back to never-authored, which is what an undo of "the DM first picked outdoor" means.
    expect('environment' in useStore.getState().mapSettings).toBe(false);
  });

  it('leaves a map that never authored any of it alone', () => {
    const before = { ...useStore.getState().mapSettings };
    new SetEnvironmentSettingsCommand({}, {}).execute();
    expect(useStore.getState().mapSettings).toEqual(before);
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

  // A preset picks the style for the NEXT shape. Everything already drawn has
  // to come through the apply looking identical — that is the whole defect.
  describe('leaves existing shapes alone', () => {
    const dungeonLayer = (): DungeonLayer => {
      const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
      if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
      return layer;
    };

    const makeShape = (id: string, styleOverrides?: Record<string, unknown>): ShapeChild => ({
      id,
      name: id,
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
      ...(styleOverrides ? { styleOverrides } : {}),
    });

    /** How each shape actually renders right now. */
    const appearances = (): DungeonStyle[] => {
      const layer = dungeonLayer();
      return layer.children
        .filter((c): c is ShapeChild => c.childType === 'shape')
        .map((c) => resolveStyle(layer.style, c.styleOverrides as Partial<DungeonStyle>));
    };

    beforeEach(() => {
      useStore.getState().resetToDefault();
      const layerId = dungeonLayer().id;
      useStore.getState().addChild(layerId, makeShape('plain-shape'));
      useStore.getState().addChild(layerId, makeShape('authored-shape', { floorColor: '#abcdef' }));
    });

    it('every existing shape renders identically after a preset is applied', () => {
      const layer = dungeonLayer();
      const before = appearances();
      // Any preset that actually changes the floor is a valid probe.
      const preset = DUNGEON_STYLE_PRESETS.find(
        (p) => p.dungeonStyle.floorColor && p.dungeonStyle.floorColor !== layer.style.floorColor,
      );
      if (!preset) throw new Error('No preset changes floorColor');

      new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style)).execute();

      expect(appearances()).toEqual(before);
      // ...while the layer style — what the next shape inherits — did move.
      expect(dungeonLayer().style.floorColor).toBe(preset.dungeonStyle.floorColor);
    });

    it('keeps a shape its own authored override rather than the pinned value', () => {
      const layer = dungeonLayer();
      const preset = DUNGEON_STYLE_PRESETS.find((p) => p.dungeonStyle.floorColor);
      if (!preset) throw new Error('No preset sets floorColor');

      new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style)).execute();

      const authored = dungeonLayer().children.find((c) => c.id === 'authored-shape');
      expect(authored?.styleOverrides?.floorColor).toBe('#abcdef');
    });

    it('does not clear a layer field the preset leaves undefined', () => {
      const layerId = dungeonLayer().id;
      useStore.getState().updateLayer(layerId, {
        style: { ...dungeonLayer().style, wallTextureSetId: 'stone-slate' },
      } as Partial<DungeonLayer>);

      // e.g. Cave / Natural, which carries `wallTextureSetId: undefined` — the
      // key that used to switch wall texture off and hide every authored wall.
      const preset = DUNGEON_STYLE_PRESETS.find(
        (p) => 'wallTextureSetId' in p.dungeonStyle && p.dungeonStyle.wallTextureSetId === undefined,
      );
      if (!preset) throw new Error('Expected a preset with an explicit undefined wall texture');

      const layer = dungeonLayer();
      new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style)).execute();

      expect(dungeonLayer().style.wallTextureSetId).toBe('stone-slate');
    });

    it('undo puts the shapes back to the overrides they had', () => {
      const layer = dungeonLayer();
      const before = appearances();
      const preset = DUNGEON_STYLE_PRESETS.find(
        (p) => p.dungeonStyle.floorColor && p.dungeonStyle.floorColor !== layer.style.floorColor,
      );
      if (!preset) throw new Error('No preset changes floorColor');

      const cmd = new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style));
      cmd.execute();
      cmd.undo();

      expect(dungeonLayer().children.find((c) => c.id === 'plain-shape')?.styleOverrides)
        .toBeUndefined();
      expect(dungeonLayer().children.find((c) => c.id === 'authored-shape')?.styleOverrides)
        .toEqual({ floorColor: '#abcdef' });
      expect(appearances()).toEqual(before);
    });
  });

  // Same rule as the shapes above, for the walls the DM drew by hand. These are
  // not `LayerChild`ren, so they pin onto themselves rather than a styleOverrides
  // bag — the stone renderer reads the pin first and the layer style second.
  describe('leaves existing standalone walls alone', () => {
    const dungeonLayer = (): DungeonLayer => {
      const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
      if (!layer || layer.type !== 'dungeon') throw new Error('No dungeon layer');
      return layer;
    };

    const makeWall = (id: string, pins?: Partial<WallSegment>): WallSegment => ({
      id,
      points: [[0, 0], [6, 0]],
      wallType: 'normal',
      direction: 'both',
      color: '#222222',
      width: 0.5,
      roughness: 0,
      ...pins,
    });

    const wallById = (id: string): WallSegment => {
      const w = dungeonLayer().standaloneWalls.find((x) => x.id === id);
      if (!w) throw new Error(`No wall ${id}`);
      return w;
    };

    /** A preset that moves the wall texture set to something real and different. */
    const wallPreset = () => {
      const p = DUNGEON_STYLE_PRESETS.find(
        (x) =>
          typeof x.dungeonStyle.wallTextureSetId === 'string' &&
          x.dungeonStyle.wallTextureSetId &&
          x.dungeonStyle.wallTextureSetId !== 'stone-slate',
      );
      if (!p) throw new Error('No preset moves the wall texture set off stone-slate');
      return p;
    };

    beforeEach(() => {
      useStore.getState().resetToDefault();
      const layerId = dungeonLayer().id;
      useStore.getState().updateLayer(layerId, {
        style: {
          ...dungeonLayer().style,
          wallTextureSetId: 'stone-slate',
          wallTextureTint: '#ffffff',
        },
      } as Partial<DungeonLayer>);
      useStore.getState().addWall(layerId, makeWall('plain-wall'));
      useStore.getState().addWall(layerId, makeWall('authored-wall', { textureSetId: 'wood-plank' }));
    });

    it('pins an unpinned wall to the set it was drawn with', () => {
      const layer = dungeonLayer();
      const preset = wallPreset();

      new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style)).execute();

      // The wall keeps what it rendered as...
      expect(wallById('plain-wall').textureSetId).toBe('stone-slate');
      // ...while the layer — what the NEXT wall inherits — moved to the preset.
      expect(dungeonLayer().style.wallTextureSetId).toBe(preset.dungeonStyle.wallTextureSetId);
    });

    it('keeps a wall its own authored pin rather than the layer value', () => {
      const layer = dungeonLayer();
      new PresetApplyCommand('test', layer.id, wallPreset(), structuredClone(layer.style)).execute();

      expect(wallById('authored-wall').textureSetId).toBe('wood-plank');
    });

    it('does not pin walls when the preset leaves the wall style alone', () => {
      const layer = dungeonLayer();
      const preset = DUNGEON_STYLE_PRESETS.find(
        (p) => !('wallTextureSetId' in p.dungeonStyle) && !('wallTextureTint' in p.dungeonStyle),
      );
      if (!preset) return; // No such preset in the registry — nothing to prove.

      new PresetApplyCommand('test', layer.id, preset, structuredClone(layer.style)).execute();

      expect(wallById('plain-wall').textureSetId).toBeUndefined();
    });

    it('undo puts the walls back to the pins they had', () => {
      const layer = dungeonLayer();
      const cmd = new PresetApplyCommand('test', layer.id, wallPreset(), structuredClone(layer.style));
      cmd.execute();
      cmd.undo();

      expect(wallById('plain-wall').textureSetId).toBeUndefined();
      expect(wallById('authored-wall').textureSetId).toBe('wood-plank');
      expect(dungeonLayer().style.wallTextureSetId).toBe('stone-slate');
    });
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

// Region move/cut route mergedFloor changes through PropertyCommand (see SelectTool).
describe('PropertyCommand mergedFloor (region move/cut undo-redo)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  const floorA: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
  const floorB: [number, number][][] = [[[5, 5], [15, 5], [15, 15], [5, 15]]];

  function dungeonLayerId(): string {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('No dungeon layer');
    return layer.id;
  }

  function mergedFloor(id: string) {
    return (useStore.getState().layers.find((l) => l.id === id) as DungeonLayer).mergedFloor;
  }

  it('region move: execute applies new floor, undo restores prior, redo reapplies', () => {
    const id = dungeonLayerId();
    useStore.getState().updateLayer(id, { mergedFloor: floorA } as Partial<DungeonLayer>);

    const cmd = new PropertyCommand(
      'Move region',
      { type: 'layer', layerId: id },
      { mergedFloor: floorA },
      { mergedFloor: floorB },
    );
    cmd.execute();
    expect(mergedFloor(id)).toEqual(floorB);
    cmd.undo();
    expect(mergedFloor(id)).toEqual(floorA);
    cmd.execute(); // redo
    expect(mergedFloor(id)).toEqual(floorB);
  });

  it('region cut: undo restores exact prior floor, redo reapplies the cut', () => {
    const id = dungeonLayerId();
    useStore.getState().updateLayer(id, { mergedFloor: floorA } as Partial<DungeonLayer>);
    const empty: [number, number][][] = [];

    const cmd = new PropertyCommand(
      'Cut region',
      { type: 'layer', layerId: id },
      { mergedFloor: floorA },
      { mergedFloor: empty },
    );
    cmd.execute();
    expect(mergedFloor(id)).toEqual(empty);
    cmd.undo();
    expect(mergedFloor(id)).toEqual(floorA);
    cmd.execute(); // redo
    expect(mergedFloor(id)).toEqual(empty);
  });
});

describe('Rename via PropertyCommand/UpdateChildCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('PropertyCommand round-trips a layer rename', () => {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const cmd = new PropertyCommand(
      'Rename layer',
      { type: 'layer', layerId: layer.id },
      { name: layer.name },
      { name: 'Dungeon Level 2' },
    );
    undoManager.execute(cmd);
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.name).toBe('Dungeon Level 2');
    undoManager.undo();
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.name).toBe(layer.name);
  });

  it('UpdateChildCommand round-trips a child rename', () => {
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    const shape: ShapeChild = {
      id: 'rename-test-child',
      name: 'Original',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    };
    useStore.getState().addChild(layer.id, shape);

    const cmd = new UpdateChildCommand('Rename', layer.id, shape.id, { name: 'Original' }, { name: 'Renamed' });
    undoManager.execute(cmd);
    expect(
      (useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer).children.find((c) => c.id === shape.id)?.name,
    ).toBe('Renamed');
    undoManager.undo();
    expect(
      (useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer).children.find((c) => c.id === shape.id)?.name,
    ).toBe('Original');
  });
});

describe('Opacity via PropertyCommand (B1 drag-commit pattern)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('round-trips layer opacity', () => {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const cmd = new PropertyCommand(
      'Layer opacity',
      { type: 'layer', layerId: layer.id },
      { opacity: 1 },
      { opacity: 0.5 },
    );
    undoManager.execute(cmd);
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.opacity).toBe(0.5);
    undoManager.undo();
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.opacity).toBe(1);
  });

  it('a live-preview drag (many raw updateLayer writes) plus one commit is exactly one undo entry', () => {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    // Live-preview writes, same as SliderInput's onChange during a drag —
    // these never touch undoManager.
    useStore.getState().updateLayer(layer.id, { opacity: 0.8 });
    useStore.getState().updateLayer(layer.id, { opacity: 0.6 });
    useStore.getState().updateLayer(layer.id, { opacity: 0.42 });
    expect(undoManager.canUndo()).toBe(false);

    // Release: the one undoable commit, start value to final value.
    undoManager.execute(new PropertyCommand(
      'Layer opacity',
      { type: 'layer', layerId: layer.id },
      { opacity: 1 },
      { opacity: 0.42 },
    ));
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.opacity).toBeCloseTo(0.42);

    undoManager.undo();
    expect(useStore.getState().layers.find((l) => l.id === layer.id)?.opacity).toBe(1);
    expect(undoManager.canUndo()).toBe(false); // exactly one entry existed
  });
});

// A zone is prep, not scenery — it must never trigger a room re-detection,
// same as a light or a label. Only shapes (what mergedFloor unions from) and
// doors (which need a roomA/B the moment they appear) do.
describe('AddChildCommand/RemoveChildCommand.affectsRooms — zones are inert', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  const ZONE: ZoneChild = {
    id: 'zone-1',
    name: 'Zone',
    childType: 'zone',
    visible: true,
    shape: { kind: 'point', position: { x: 1, y: 1 } },
  };

  const DOOR: DoorChild = {
    id: 'door-1',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: '',
    position: [1, 1],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };

  it('adding a zone child does not affect rooms; adding a door does', () => {
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    expect(new AddChildCommand('Add zone', layer.id, ZONE).affectsRooms).toBe(false);
    expect(new AddChildCommand('Add door', layer.id, DOOR).affectsRooms).toBe(true);
  });

  it('removing a zone child does not affect rooms; removing a door does', () => {
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.getState().addChild(layer.id, ZONE);
    useStore.getState().addChild(layer.id, DOOR);

    const removeZone = new RemoveChildCommand('Remove zone', layer.id, ZONE.id);
    removeZone.execute();
    expect(removeZone.affectsRooms).toBe(false);

    const removeDoor = new RemoveChildCommand('Remove door', layer.id, DOOR.id);
    removeDoor.execute();
    expect(removeDoor.affectsRooms).toBe(true);
  });
});
