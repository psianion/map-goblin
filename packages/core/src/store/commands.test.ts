import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { PresetApplyCommand, PropertyCommand, ShapeStyleCommand } from './commands';
import { DUNGEON_STYLE_PRESETS } from './presetRegistry';
import { resolveStyle } from '../engine/styleResolver';
import type { ShapeChild, WallSegment } from '../shared/types';
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
