import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, ShapeChild } from '@/store/types';
import { createDungeonLayer } from '@dnd/core/src/store/factories';
import {
  STRIP_CAP,
  assetBrowserHint,
  floorBrowserHint,
  floorColourDefaults,
  floorColourGesture,
  floorColourPatches,
  floorColourValue,
  floorScopeLabel,
  floorSeenColour,
  floorTargets,
  floorTargetsOf,
  floorCandidates,
  orderStripCandidates,
  pickAssetForTool,
  pickFloorTexture,
  pickTerrainSlotTexture,
  pickWallSet,
  pickedFloorTexture,
  propCandidates,
  PROP_STRIP_CAP,
  wallSetCandidates,
  wallSetForAsset,
  wallSetThumb,
  wallWidthIgnored,
} from './assetStrip';

// A small catalogue in place of the installed packs, so the order is known.
const CATALOGUE = [
  { id: 'p:floor_a', type: 'floor' },
  { id: 'p:floor_b', type: 'floor' },
  { id: 'p:floor_c', type: 'floor' },
  { id: 'gg-forge:flagstone', type: 'floor' },
  { id: 'p:crate', type: 'object' },
  { id: 'p:barrel', type: 'object' },
  { id: 'p:leaves', type: 'scatter' },
  { id: 'p:stone_straight', type: 'wall', set: 'GG_Stone', pieceType: 'straight' },
  { id: 'p:stone_corner', type: 'wall', set: 'GG_Stone', pieceType: 'corner' },
  { id: 'p:brick_straight', type: 'wall', set: 'GG_Brick', pieceType: 'straight' },
  { id: 'p:wood_straight', type: 'wall', set: 'GG_Wood', pieceType: 'straight' },
  // A cave kit: rock the walk lays along the floor edge, shipped as objects.
  { id: 'p:cave_bend', type: 'object', set: 'GG_Cave', material: 'inside_bend' },
  { id: 'p:cave_short', type: 'object', set: 'GG_Cave', material: 'wall_short' },
].map((e) => ({ ...e, packId: e.id.split(':')[0], label: e.id.split(':')[1].replace(/_/g, ' ') }));
/** Entries a test adds for itself; emptied after each. */
const EXTRA: typeof CATALOGUE = [];
const all = () => [...CATALOGUE, ...EXTRA];
afterEach(() => {
  EXTRA.length = 0;
});

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>();
  const byId = (id: string) => all().find((e) => e.id === id);
  return {
    ...actual,
    getCatalogEntry: (id: string) => byId(id),
    getEntriesByType: (type: string) => all().filter((e) => e.type === type),
    familyOfKey: (key: string) => (key === 'p:demo-storage:barrel' ? [byId('p:barrel')] : []),
    getWallSetIds: () => [...new Set(CATALOGUE.filter((e) => e.type === 'wall').map((e) => e.set as string))].sort(),
    getBandSetIds: () => ['GG_Cave'],
    getBandSet: (set: string) => (set === 'GG_Cave' ? CATALOGUE.filter((e) => e.set === set) : []),
    isBandSet: (set: string | undefined) => set === 'GG_Cave',
    getWallPieces: (set: string, piece: string) => CATALOGUE.filter((e) => e.set === set && e.pieceType === piece),
  };
});

vi.mock('@/lib/toast', () => ({
  notify: { subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), action: vi.fn() },
}));

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function shape(id: string, textureId?: string): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    roughnessEnabled: false,
    textureId,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

const targetsWith = (ids: string[]) => floorTargetsOf(useStore.getState().layers, dungeon().id, ids);

function shapeById(id: string): ShapeChild {
  const c = dungeon().children.find((x) => x.id === id);
  if (!c || c.childType !== 'shape') throw new Error(`no shape ${id}`);
  return c;
}

describe('orderStripCandidates', () => {
  it('puts recents before suggestions', () => {
    expect(orderStripCandidates(['r1', 'r2'], ['s1', 's2'])).toEqual(['r1', 'r2', 's1', 's2']);
  });

  it('lists each id once, at its first place', () => {
    expect(orderStripCandidates(['a', 'b', 'a'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('skips blanks', () => {
    expect(orderStripCandidates([undefined, 'a', ''], [null, 'b'])).toEqual(['a', 'b']);
  });

  it(`stops at the cap, ${STRIP_CAP} by default`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`);
    expect(orderStripCandidates(['r'], many)).toHaveLength(STRIP_CAP);
    expect(orderStripCandidates(['r'], many)[0]).toBe('r');
    expect(orderStripCandidates(['a', 'b', 'c'], ['d'], 2)).toEqual(['a', 'b']);
  });
});

describe('strip candidates per tab', () => {
  it('floors: recent floors, then the one in use, the layer default, the catalogue', () => {
    const recent = ['p:crate', 'p:floor_c', 'unknown:floor'];
    expect(floorCandidates(recent, 'p:floor_b', 'p:floor_a')).toEqual([
      'p:floor_c',
      'p:floor_b',
      'p:floor_a',
      'gg-forge:flagstone',
    ]);
    // A default the packs do not hold has nothing to draw, so it is left out.
    expect(floorCandidates([], undefined, 'legacy-floor-01')).toEqual([
      'gg-forge:flagstone',
      'p:floor_a',
      'p:floor_b',
      'p:floor_c',
    ]);
  });

  it('floors: the preferred pack leads the catalogue, after recents and the layer default', () => {
    expect(floorCandidates(['p:floor_c'], undefined, 'p:floor_b')).toEqual([
      'p:floor_c',
      'p:floor_b',
      'gg-forge:flagstone',
      'p:floor_a',
    ]);
  });

  it('walls: sets of the recent pieces first, then the layer set, then every set', () => {
    expect(wallSetCandidates(['p:wood_straight', 'p:crate', 'p:stone_corner'], 'GG_Brick')).toEqual([
      'GG_Wood',
      'GG_Stone',
      'GG_Brick',
      'GG_Cave',
    ]);
    expect(wallSetCandidates([], undefined)).toEqual(['GG_Brick', 'GG_Stone', 'GG_Wood', 'GG_Cave']);
  });

  it('walls: a cave kit is a set like the others, shown by its short straight piece', () => {
    expect(wallSetThumb('GG_Cave')).toBe('p:cave_short');
    expect(wallSetForAsset('p:cave_bend')).toBe('GG_Cave');
    expect(wallSetForAsset('p:crate')).toBeUndefined();
    // Picked lately, it leads; as the layer's set, it comes straight after the recents.
    expect(wallSetCandidates(['p:cave_short'], 'GG_Brick')).toEqual(['GG_Cave', 'GG_Brick', 'GG_Stone', 'GG_Wood']);
    expect(wallSetCandidates(['p:wood_straight'], 'GG_Cave')).toEqual(['GG_Wood', 'GG_Cave', 'GG_Brick', 'GG_Stone']);
  });

  it('walls: only a cave kit leaves the width alone', () => {
    expect(wallWidthIgnored('GG_Cave')).toBe(true);
    expect(wallWidthIgnored('GG_Stone')).toBe(false);
    expect(wallWidthIgnored(undefined)).toBe(false);
  });

  it('props: recent objects and scatter, then what the brush holds, then the catalogue objects', () => {
    expect(propCandidates(['p:leaves', 'p:floor_a'], ['p:barrel'])).toEqual(['p:leaves', 'p:barrel', 'p:crate']);
  });

  it('props: starred props come first, ahead of the recents', () => {
    expect(propCandidates(['p:leaves'], ['p:barrel'], ['p:crate', 'p:cave_short'])).toEqual([
      'p:crate',
      'p:leaves',
      'p:barrel',
    ]);
  });

  it('props: eight tiles, starred first, then recents, then the catalogue, each once', () => {
    EXTRA.push(
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => ({ id: `p:obj_${n}`, type: 'object', packId: 'p', label: `obj ${n}` })),
    );
    const out = propCandidates(['p:obj_b', 'p:crate'], [], ['p:crate', 'p:obj_a']);
    expect(PROP_STRIP_CAP).toBe(8);
    expect(out).toEqual(['p:crate', 'p:obj_a', 'p:obj_b', 'p:barrel', 'p:obj_c', 'p:obj_d', 'p:obj_e', 'p:obj_f']);
  });

  it('props: a starred family stands in the strip as its first member', () => {
    expect(propCandidates([], [], ['p:demo-storage:barrel'])).toEqual(['p:barrel', 'p:crate']);
  });

  it("props: a cave kit's rock pieces are walls, never props, even when picked lately", () => {
    expect(propCandidates(['p:cave_short'], [])).toEqual(['p:crate', 'p:barrel']);
  });
});

describe('pickFloorTexture', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
    });
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().addChild(dungeon().id, shape('b', 'p:floor_b'));
    useStore.getState().addChild(dungeon().id, shape('c', 'p:floor_a'));
    useStore.getState().setActiveLayerId(dungeon().id);
  });

  it('with nothing selected, retextures every floor on the layer and its next ones, in one undo step', () => {
    const before = dungeon().style.defaultTextureId;
    useStore.getState().updateChild(dungeon().id, 'a', { textureTint: '#ff0000', textureScale: 2 });
    pickFloorTexture('p:floor_c');

    expect(dungeon().style.defaultTextureId).toBe('p:floor_c');
    expect(['a', 'b', 'c'].map((id) => shapeById(id).textureId)).toEqual(['p:floor_c', 'p:floor_c', 'p:floor_c']);
    // Only the texture changes: each floor keeps its own tint and fill.
    expect(shapeById('a').textureTint).toBe('#ff0000');
    expect(shapeById('a').textureScale).toBe(2);

    undoManager.undo();
    expect(dungeon().style.defaultTextureId).toBe(before);
    expect(['a', 'b', 'c'].map((id) => shapeById(id).textureId)).toEqual(['p:floor_a', 'p:floor_b', 'p:floor_a']);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('retextures only the selected shapes, and sets the next floors, in one undo step', () => {
    const before = dungeon().style.defaultTextureId;
    useStore.getState().setSelectedIds(['a', 'b']);
    pickFloorTexture('p:floor_c');

    expect(shapeById('a').textureId).toBe('p:floor_c');
    expect(shapeById('b').textureId).toBe('p:floor_c');
    expect(shapeById('c').textureId).toBe('p:floor_a');
    expect(dungeon().style.defaultTextureId).toBe('p:floor_c');

    undoManager.undo();
    expect(shapeById('a').textureId).toBe('p:floor_a');
    expect(shapeById('b').textureId).toBe('p:floor_b');
    expect(dungeon().style.defaultTextureId).toBe(before);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('leaves a locked layer alone', () => {
    useStore.getState().setSelectedIds(['a']);
    useStore.getState().updateLayer(dungeon().id, { locked: true });
    pickFloorTexture('p:floor_c');
    expect(shapeById('a').textureId).toBe('p:floor_a');
  });

  it('marks the texture the target floors share: the selection, else the whole layer', () => {
    expect(pickedFloorTexture(targetsWith(['a', 'c']))).toBe('p:floor_a');
    expect(pickedFloorTexture(targetsWith(['a', 'b']))).toBeUndefined();
    expect(pickedFloorTexture(targetsWith([]))).toBeUndefined();
    useStore.getState().updateChild(dungeon().id, 'b', { textureId: 'p:floor_a' });
    expect(pickedFloorTexture(targetsWith([]))).toBe('p:floor_a');
  });

  it('marks the layer default on a layer with no floors yet', () => {
    useStore.getState().resetToDefault();
    expect(pickedFloorTexture(targetsWith([]))).toBe(dungeon().style.defaultTextureId);
  });

  it('with nothing selected and an empty active layer, retextures every floor on the visible, unlocked layers', () => {
    const keep = dungeon().id;
    const hidden = createDungeonLayer('Hidden');
    const locked = createDungeonLayer('Locked');
    const empty = createDungeonLayer('Layer 1');
    for (const l of [hidden, locked, empty]) useStore.getState().addLayer(l);
    useStore.getState().addChild(hidden.id, shape('h', 'p:floor_a'));
    useStore.getState().addChild(locked.id, shape('l', 'p:floor_a'));
    useStore.getState().updateLayer(hidden.id, { visible: false });
    useStore.getState().updateLayer(locked.id, { locked: true });
    useStore.getState().setActiveLayerId(empty.id);

    const t = floorTargets();
    expect(t.scope).toBe('map');
    expect(floorScopeLabel(t)).toBe('every floor on the map');
    expect(t.parts.map((p) => p.layer.id)).toEqual([keep]);

    pickFloorTexture('p:floor_c');
    expect(['a', 'b', 'c'].map((id) => shapeById(id).textureId)).toEqual(['p:floor_c', 'p:floor_c', 'p:floor_c']);
    const layer = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;
    expect((layer(hidden.id).children[0] as ShapeChild).textureId).toBe('p:floor_a');
    expect((layer(locked.id).children[0] as ShapeChild).textureId).toBe('p:floor_a');
    // New floors stay per active layer: the empty layer takes the default, the Keep keeps its own.
    expect(layer(empty.id).style.defaultTextureId).toBe('p:floor_c');

    undoManager.undo();
    expect(['a', 'b', 'c'].map((id) => shapeById(id).textureId)).toEqual(['p:floor_a', 'p:floor_b', 'p:floor_a']);
    expect(layer(empty.id).style.defaultTextureId).not.toBe('p:floor_c');
  });

  it('puts the texture at the front of the recents', () => {
    pickFloorTexture('p:floor_c');
    expect(useStore.getState().assets.recentlyUsed[0]).toBe('p:floor_c');
  });
});

describe('pickWallSet', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
    });
  });

  it('sets the layer wall set at its default width, undoably, and remembers its straight run', () => {
    const before = dungeon().style;
    useStore.getState().updateLayer(dungeon().id, { style: { ...before, wallWidth: 1.2 } } as Partial<DungeonLayer>);
    pickWallSet(dungeon(), 'GG_Stone');

    expect(dungeon().style.wallTextureSetId).toBe('GG_Stone');
    expect(dungeon().style.wallWidth).toBe(0.5);
    expect(useStore.getState().assets.recentlyUsed[0]).toBe('p:stone_straight');

    undoManager.undo();
    expect(dungeon().style.wallTextureSetId).toBe(before.wallTextureSetId);
    expect(dungeon().style.wallWidth).toBe(1.2);
  });

  it('sets a cave kit the same way, remembering its short straight piece', () => {
    pickWallSet(dungeon(), 'GG_Cave');
    expect(dungeon().style.wallTextureSetId).toBe('GG_Cave');
    expect(useStore.getState().assets.recentlyUsed[0]).toBe('p:cave_short');
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();
    expect(dungeon().style.wallTextureSetId).not.toBe('GG_Cave');
  });
});

describe('pickAssetForTool', () => {
  const brush = () => useStore.getState().tools.settings.scatterBrush;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
    });
    useStore.getState().setActiveLayerId(dungeon().id);
    useStore.getState().updateScatterBrushSettings({ assetIds: [], stampMode: false });
  });

  it('a floor texture with a floor tool in hand and nothing selected goes on every floor and the next ones, not a stamp', () => {
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().addChild(dungeon().id, shape('b', 'p:floor_b'));
    useStore.getState().setActiveTool('rectangle');
    pickAssetForTool('p:floor_c');

    expect(shapeById('a').textureId).toBe('p:floor_c');
    expect(shapeById('b').textureId).toBe('p:floor_c');
    expect(dungeon().style.defaultTextureId).toBe('p:floor_c');
    expect(useStore.getState().tools.activeTool).toBe('rectangle');
    expect(brush().assetIds).toEqual([]);

    undoManager.undo();
    expect(shapeById('a').textureId).toBe('p:floor_a');
    expect(shapeById('b').textureId).toBe('p:floor_b');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a floor texture with a floor tool in hand retextures the selected shapes', () => {
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().setSelectedIds(['a']);
    useStore.getState().setActiveTool('path');
    pickAssetForTool('p:floor_b');

    expect(shapeById('a').textureId).toBe('p:floor_b');
    expect(brush().assetIds).toEqual([]);
  });

  it('a floor texture retextures the selected shapes with the select tool, in one undo step', () => {
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().addChild(dungeon().id, shape('b', 'p:floor_b'));
    useStore.getState().addChild(dungeon().id, shape('c', 'p:floor_a'));
    useStore.getState().setActiveTool('select');
    useStore.getState().setSelectedIds(['a', 'b']);
    pickAssetForTool('p:floor_c');

    expect(shapeById('a').textureId).toBe('p:floor_c');
    expect(shapeById('b').textureId).toBe('p:floor_c');
    expect(shapeById('c').textureId).toBe('p:floor_a');
    expect(useStore.getState().tools.activeTool).toBe('select');
    expect(brush().assetIds).toEqual([]);

    undoManager.undo();
    expect(shapeById('a').textureId).toBe('p:floor_a');
    expect(shapeById('b').textureId).toBe('p:floor_b');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a floor texture goes to the selected shapes before the terrain slot', () => {
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().setActiveTool('terrain');
    useStore.getState().updateTerrainBrushSettings({ slot: 1 });
    useStore.getState().setSelectedIds(['a']);
    const palette = useStore.getState().mapSettings.terrain?.palette;
    pickAssetForTool('p:floor_c');

    expect(shapeById('a').textureId).toBe('p:floor_c');
    expect(useStore.getState().mapSettings.terrain?.palette).toEqual(palette);
    expect(useStore.getState().tools.activeTool).toBe('terrain');
  });

  it('a floor texture is never a prop: with any tool and no floor selected it goes on every floor', () => {
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    const picks = [
      ['select', 'p:floor_c'],
      ['wall', 'p:floor_b'],
      ['scatterBrush', 'p:floor_c'],
    ] as const;
    for (const [tool, texture] of picks) {
      useStore.getState().setActiveTool(tool);
      useStore.getState().setSelectedIds(['missing']);
      pickAssetForTool(texture);
      expect(useStore.getState().tools.activeTool).toBe(tool);
      expect(brush().assetIds).toEqual([]);
      expect(shapeById('a').textureId).toBe(texture);
      expect(dungeon().style.defaultTextureId).toBe(texture);
    }
  });

  it('a wall piece with the wall tool in hand sets the layer wall set', () => {
    useStore.getState().setActiveTool('wall');
    pickAssetForTool('p:brick_straight');

    expect(dungeon().style.wallTextureSetId).toBe('GG_Brick');
    expect(useStore.getState().tools.activeTool).toBe('wall');
    expect(brush().assetIds).toEqual([]);
  });

  it('a cave kit piece with the wall tool in hand sets the layer to that kit', () => {
    useStore.getState().setActiveTool('wall');
    pickAssetForTool('p:cave_bend');

    expect(dungeon().style.wallTextureSetId).toBe('GG_Cave');
    expect(brush().assetIds).toEqual([]);
  });

  it('a floor texture with the terrain brush in hand fills the brush slot', () => {
    useStore.getState().setActiveTool('terrain');
    useStore.getState().updateTerrainBrushSettings({ slot: 2 });
    pickAssetForTool('p:floor_c');

    expect(useStore.getState().mapSettings.terrain?.palette[2]).toBe('p:floor_c');
    expect(useStore.getState().tools.activeTool).toBe('terrain');
    expect(brush().assetIds).toEqual([]);
  });

  it('a prop is a prop whatever the tool', () => {
    useStore.getState().setActiveTool('rectangle');
    pickAssetForTool('p:crate');

    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
    expect(brush().assetIds).toEqual(['p:crate']);
  });
});

describe('assetBrowserHint', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(dungeon().id);
  });

  it('says nothing special while stamping props', () => {
    useStore.getState().setActiveTool('select');
    expect(assetBrowserHint(useStore.getState())).toBeUndefined();
  });

  it('never says stamp on the Floor tab, and names the floors a pick changes', () => {
    const hint = () => floorBrowserHint(useStore.getState());
    useStore.getState().setActiveTool('rectangle');
    expect(hint()).toBe('Click a texture to use it for new floors on this layer');
    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    expect(hint()).toBe('Click a texture to apply it to every floor on this layer');
    expect(assetBrowserHint(useStore.getState())).toBe(
      'Click a texture to apply it to every floor on this layer, or a prop to stamp it',
    );
    // An empty layer on top of the drawn one: the pick goes to the whole map.
    const empty = createDungeonLayer('Layer 1');
    useStore.getState().addLayer(empty);
    useStore.getState().setActiveLayerId(empty.id);
    expect(hint()).toBe('Click a texture to apply it to every floor on the map');
    useStore.getState().setActiveTool('select');
    expect(hint()).toBe('Click a texture to apply it to every floor on the map');
    useStore.getState().setActiveTool('terrain');
    expect(hint()).toMatch(/^Click a texture to assign it to slot/);
    useStore.getState().setSelectedIds(['a']);
    expect(hint()).toBe('Click a texture to apply it to the selected floors');
  });

  it('names the selected floors first, the terrain slot second', () => {
    useStore.getState().setActiveTool('terrain');
    useStore.getState().updateTerrainBrushSettings({ slot: 2 });
    expect(assetBrowserHint(useStore.getState())).toBe('Click a texture to assign it to slot 3');

    useStore.getState().addChild(dungeon().id, shape('a', 'p:floor_a'));
    useStore.getState().setSelectedIds(['a']);
    expect(assetBrowserHint(useStore.getState())).toBe('Click a texture to apply it to the selected floors');
  });
});

describe('pickTerrainSlotTexture', () => {
  const palette = () => useStore.getState().mapSettings.terrain?.palette;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.assets.recentlyUsed = [];
      s.mapSettings.terrain = undefined;
    });
  });

  it('fills one slot of a map that has no terrain yet, leaving six slots', () => {
    pickTerrainSlotTexture(3, 'p:floor_a');
    expect(palette()).toEqual([null, null, null, 'p:floor_a', null, null]);
    expect(useStore.getState().assets.recentlyUsed[0]).toBe('p:floor_a');
  });

  it('replaces a filled slot and keeps the others', () => {
    useStore.getState().setTerrainData({ palette: ['p:floor_a', 'p:floor_b', null, null, null, null] });
    pickTerrainSlotTexture(1, 'p:floor_c');
    expect(palette()).toEqual(['p:floor_a', 'p:floor_c', null, null, null, null]);
  });

  it('empties a slot with null, without counting it as a recent pick', () => {
    useStore.getState().setTerrainData({ palette: ['p:floor_a', 'p:floor_b', null, null, null, null] });
    pickTerrainSlotTexture(0, null);
    expect(palette()).toEqual([null, 'p:floor_b', null, null, null, null]);
    expect(useStore.getState().assets.recentlyUsed).toEqual([]);
  });

  it('ignores slots off the palette', () => {
    pickTerrainSlotTexture(6, 'p:floor_a');
    pickTerrainSlotTexture(-1, 'p:floor_a');
    expect(palette()).toBeUndefined();
  });
});

describe('Floor colour', () => {
  const pins = (id: string) => (shapeById(id).styleOverrides as { floorColor?: string } | undefined)?.floorColor;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(dungeon().id);
    const id = dungeon().id;
    // Two textured floors (one with a colour pinned under its art), a plain one with its
    // own colour, and a plain one following the layer.
    useStore.getState().addChild(id, shape('tex', 'p:floor_a'));
    useStore.getState().addChild(id, { ...shape('texPinned', 'p:floor_a'), styleOverrides: { floorColor: '#ff0000', wallColor: '#111111' } });
    useStore.getState().addChild(id, { ...shape('plainPinned'), styleOverrides: { floorColor: '#00ff00' } });
    useStore.getState().addChild(id, shape('plain'));
    useStore.getState().updateLayer(id, { style: { ...dungeon().style, floorColor: '#b8ac92' } });
  });

  it('reads as a floor looks: tint on a texture, colour on a plain floor', () => {
    const style = dungeon().style;
    expect(floorSeenColour(shapeById('tex'), style)).toBe('#ffffff');
    expect(floorSeenColour(shapeById('plainPinned'), style)).toBe('#00ff00');
    expect(floorSeenColour(shapeById('plain'), style)).toBe('#b8ac92');
    expect(floorColourValue(targetsWith([]))).toEqual({ colour: '#ffffff', mixed: true });
    expect(floorColourValue(targetsWith(['tex', 'texPinned']))).toEqual({ colour: '#ffffff', mixed: false });
    expect(floorColourValue(targetsWith(['plain']))).toEqual({ colour: '#b8ac92', mixed: false });
  });

  it('nothing selected: tints every textured floor, colours the layer, takes the floors own colours off', () => {
    const shapes = dungeon().children.filter((c): c is ShapeChild => c.childType === 'shape');
    const out = floorColourPatches(shapes, true, '#3060c0');
    expect(floorColourDefaults('layer', '#3060c0')).toEqual({ floorColor: '#3060c0', defaultTextureTint: '#3060c0' });
    expect(out.get('tex')).toEqual({ textureTint: '#3060c0', styleOverrides: undefined });
    expect(out.get('texPinned')).toEqual({ textureTint: '#3060c0', styleOverrides: { wallColor: '#111111' } });
    expect(out.get('plainPinned')).toEqual({ textureTint: '#ffffff', styleOverrides: undefined });
  });

  it('a selection: only those floors, each pinned where it shows a colour, the layer colour untouched', () => {
    const out = floorColourPatches([shapeById('texPinned'), shapeById('plain'), shapeById('tex')], false, '#3060c0');
    expect(floorColourDefaults('selected', '#3060c0')).toEqual({ defaultTextureTint: '#3060c0' });
    expect(out.get('tex')).toEqual({ textureTint: '#3060c0', styleOverrides: undefined });
    expect(out.get('texPinned')?.styleOverrides).toEqual({ floorColor: '#3060c0', wallColor: '#111111' });
    expect(out.get('plain')).toEqual({ textureTint: '#ffffff', styleOverrides: { floorColor: '#3060c0' } });
  });

  it('a drag previews live on every floor of the layer and lands as one undo step', () => {
    const g = floorColourGesture();
    g.preview('#101010');
    g.preview('#3060c0');
    expect(undoManager.canUndo()).toBe(false);
    for (const id of ['tex', 'texPinned', 'plainPinned', 'plain']) {
      expect(floorSeenColour(shapeById(id), dungeon().style)).toBe('#3060c0');
    }
    g.commit();
    expect(dungeon().style.floorColor).toBe('#3060c0');
    expect(dungeon().style.defaultTextureTint).toBe('#3060c0');
    expect(pins('texPinned')).toBeUndefined();

    undoManager.undo();
    expect(undoManager.canUndo()).toBe(false);
    expect(shapeById('tex').textureTint).toBe('#ffffff');
    expect(pins('texPinned')).toBe('#ff0000');
    expect(pins('plainPinned')).toBe('#00ff00');
    expect(dungeon().style.floorColor).toBe('#b8ac92');
    expect(dungeon().style.defaultTextureTint).toBeUndefined();

    undoManager.redo();
    expect(shapeById('tex').textureTint).toBe('#3060c0');
    expect(floorSeenColour(shapeById('plainPinned'), dungeon().style)).toBe('#3060c0');
  });

  it('an empty active layer: colours every floor on the map, pinning plain ones, one undo step', () => {
    const keep = dungeon();
    const empty = createDungeonLayer('Layer 1');
    useStore.getState().addLayer(empty);
    useStore.getState().setActiveLayerId(empty.id);
    const t = floorTargets();
    expect(t.scope).toBe('map');

    const g = floorColourGesture();
    g.preview('#3060c0');
    g.commit();
    expect(shapeById('tex').textureTint).toBe('#3060c0');
    expect(pins('plain')).toBe('#3060c0');
    expect(floorSeenColour(shapeById('plainPinned'), dungeon().style)).toBe('#3060c0');
    // The Keep's own layer colour is left; the empty layer's new floors take the pick.
    expect(dungeon().style.floorColor).toBe(keep.style.floorColor);
    const active = () => useStore.getState().layers.find((l) => l.id === empty.id) as DungeonLayer;
    expect(active().style.defaultTextureTint).toBe('#3060c0');
    expect(active().style.floorColor).toBe('#3060c0');

    undoManager.undo();
    expect(shapeById('tex').textureTint).toBe('#ffffff');
    expect(pins('plain')).toBeUndefined();
    expect(pins('plainPinned')).toBe('#00ff00');
    expect(active().style.defaultTextureTint).toBeUndefined();
  });

  it('with a floor selected, changes only it', () => {
    useStore.getState().setSelectedIds(['tex']);
    const g = floorColourGesture();
    g.preview('#3060c0');
    g.commit();
    expect(shapeById('tex').textureTint).toBe('#3060c0');
    expect(shapeById('texPinned').textureTint).toBe('#ffffff');
    expect(floorSeenColour(shapeById('plain'), dungeon().style)).toBe('#b8ac92');
    expect(dungeon().style.floorColor).toBe('#b8ac92');
    undoManager.undo();
    expect(shapeById('tex').textureTint).toBe('#ffffff');
  });

  it('a visit that changes nothing leaves no undo step, and a locked layer is left alone', () => {
    const g = floorColourGesture();
    g.commit();
    expect(undoManager.canUndo()).toBe(false);
    useStore.getState().updateLayer(dungeon().id, { locked: true });
    g.preview('#3060c0');
    g.commit();
    expect(shapeById('tex').textureTint).toBe('#ffffff');
    expect(undoManager.canUndo()).toBe(false);
  });
});
