import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { createDefaultState } from '@/store/factories';
import { createRegistry } from '@/editor/registry';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { validateRegistry } from '@/editor/registry/validate';
import { createSettings } from '@/editor/registry/settings';
import { cards, families } from '@/editor/families';
import { terrain } from './index';
import { brushKindOf, materialInHand } from './material';
import { formatValue } from '@/editor/surfaces/model';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import { brushMaterialIds } from '@dnd/core/src/assets/materialKit';
import { getAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';

const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);

const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
const GRASS = 'gg-forge:wild_grass_8x8_floor_A';
const WATER = 'gg-forge:wild_water_8x8_floor_A';

/** Runs `fn` with a pack that ships grass, dirt and water. */
function withGroundPack(fn: () => void): void {
  const manager = getAssetPackManager() as unknown as { manifestCache: Map<string, unknown>; catalogVersion: number };
  manager.manifestCache.set('gg-forge', {
    name: 'gg-forge',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: {
      wild_grass_8x8_floor_A: { type: 'floor', material: 'wild_grass', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] },
      wild_dirt_8x8_floor_A: { type: 'floor', material: 'wild_dirt', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'dirt'] },
      wild_water_8x8_floor_A: { type: 'floor', material: 'wild_water', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
    },
  });
  manager.catalogVersion++;
  try {
    fn();
  } finally {
    manager.manifestCache.delete('gg-forge');
    manager.catalogVersion++;
  }
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().resetToDefault();
});

describe('the Terrain family', () => {
  it('passes every registry rule beside Design, bindings included', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
  });

  it('holds the three brushes and Path under T, keys B, W, A and P', () => {
    expect([terrain.key, terrain.tools.map((t) => [t.label, t.key, t.engine])]).toEqual([
      'T',
      [
        ['Terrain brush', 'B', ['terrain']],
        ['Water brush', 'W', ['water']],
        ['Material brush', 'A', ['material']],
        ['Path', 'P', ['path']],
      ],
    ]);
  });

  it('parses every default', () => {
    for (const d of terrain.tools.flatMap((t) => t.settings)) expect(d.schema.safeParse(d.default).success, d.id).toBe(true);
  });
});

describe('the one brush under its three entries', () => {
  const ids = (tool: string, home: 'dock' | 'panel') => reg.settingsByHome(tool, home).map((s) => s.id);

  it('gives Terrain, Water and Material the same controls', () => {
    for (const home of ['dock', 'panel'] as const) {
      expect(ids('terrainBrush', home)).toEqual(ids('materialBrush', home));
      expect(ids('waterBrush', home)).toEqual(ids('materialBrush', home));
    }
    expect(ids('materialBrush', 'dock')).toEqual(['material.size', 'material.strength', 'material.feather', 'material.overRooms']);
    expect(ids('materialBrush', 'panel')).toEqual([
      'terrain.mode',
      'material.rockOnCut',
      'material.smooth',
      'material.border',
      'material.floor',
      'material.height',
      'material.shore',
      'material.shoreWidth',
      'material.shallowLine',
    ]);
  });

  it('differs only in the swatches each lists first', () => {
    expect(reg.toolById('terrainBrush')!.dock.map((c) => c.id)).toEqual(['terrain.ground']);
    expect(reg.toolById('waterBrush')!.dock.map((c) => c.id)).toEqual(['terrain.water']);
    expect(reg.toolById('materialBrush')!.dock.map((c) => c.id)).toEqual(['material.swatches']);
    withGroundPack(() => {
      expect(brushMaterialIds('terrain').slice(0, 2)).toEqual([GRASS, DIRT]);
      expect(brushMaterialIds('water')[0]).toBe(WATER);
      expect([...brushMaterialIds('water')].sort()).toEqual([...brushMaterialIds('material')].sort());
    });
  });

  it('remembers a texture per entry: ground for Terrain, water for Water, the picked material for Material', () => {
    withGroundPack(() => {
      const inHand = (tool: 'terrain' | 'water' | 'material') => {
        useStore.getState().setActiveTool(tool);
        return [brushKindOf(useStore.getState()), materialInHand(useStore.getState())];
      };
      expect(inHand('terrain')).toEqual(['terrain', GRASS]);
      expect(inHand('water')).toEqual(['water', WATER]);
      expect(inHand('material')).toEqual(['material', 'GG_Cave_Ink']);
      useStore.setState((s) => {
        s.tools.settings.material.groundMaterial = DIRT;
      });
      expect(inHand('terrain')).toEqual(['terrain', DIRT]);
      expect(inHand('material')).toEqual(['material', 'GG_Cave_Ink']);
    });
  });

  it('writes Strength as the next piece’s opacity, full stored as nothing, and Paint over rooms off unless set', () => {
    expect(settings.getSetting('material.strength')).toBe(1);
    expect(settings.setSetting('material.strength', 0.5)).toBe(true);
    expect(useStore.getState().tools.settings.material.strength).toBe(0.5);
    settings.setSetting('material.strength', 1);
    expect(useStore.getState().tools.settings.material.strength).toBeUndefined();
    expect(settings.setSetting('material.strength', 0.72)).toBe(true);
    expect(useStore.getState().tools.settings.material.strength).toBe(0.7);
    expect(reg.settingById('material.overRooms')).toMatchObject({ label: 'Paint over rooms', control: 'switch', home: 'dock', default: false });
    expect(settings.getSetting('material.overRooms')).toBe(false);
    expect(settings.setSetting('material.overRooms', true)).toBe(true);
    expect(useStore.getState().tools.settings.material.overRooms).toBe(true);
    settings.setSetting('material.overRooms', false);
    expect(useStore.getState().tools.settings.material.overRooms).toBeUndefined();
  });

  it('writes Feather as a share of the brush in twentieths, its default stored as nothing', () => {
    expect(reg.settingById('material.feather')).toMatchObject({ label: 'Feather', control: 'slider', home: 'dock', default: 0.5 });
    expect(reg.settingById('material.feather')!.range).toEqual({ min: 0, max: 1, step: 0.05, unit: '%' });
    expect(settings.getSetting('material.feather')).toBe(0.5);
    expect(settings.setSetting('material.feather', 0)).toBe(true);
    expect(useStore.getState().tools.settings.material.feather).toBe(0);
    expect(settings.setSetting('material.feather', 0.2)).toBe(true);
    expect(useStore.getState().tools.settings.material.feather).toBe(0.2);
    expect(settings.setSetting('material.feather', 0.33)).toBe(true);
    expect(useStore.getState().tools.settings.material.feather).toBe(0.35);
    expect(settings.setSetting('material.feather', 1.5)).toBe(false);
    settings.setSetting('material.feather', 0.5);
    expect(useStore.getState().tools.settings.material.feather).toBeUndefined();
  });

  it('draws Size, Strength and Feather as typed sliders: Size in cells by half steps, the others in percent by 5%', () => {
    const def = (id: string) => reg.settingById(id)!;
    expect(def('material.size')).toMatchObject({ control: 'slider', typed: true, range: { min: 0.5, max: 12, step: 0.5 } });
    expect(def('material.size').range!.unit).toBeUndefined();
    expect(def('material.strength')).toMatchObject({ control: 'slider', typed: true, range: { min: 0.1, max: 1, step: 0.05, unit: '%' } });
    expect(def('material.feather')).toMatchObject({ control: 'slider', typed: true, range: { min: 0, max: 1, step: 0.05, unit: '%' } });
    expect(formatValue(def('material.size'), 0.5)).toBe('0.5');
    expect(formatValue(def('material.strength'), 0.7)).toBe('70%');
    expect(formatValue(def('material.feather'), 0.35)).toBe('35%');
  });

  it('picks Erase on the Mode seg, the erase mode Scatter shares', () => {
    expect(settings.getSetting('terrain.mode')).toBe(false);
    expect(settings.setSetting('terrain.mode', true)).toBe(true);
    expect(useStore.getState().tools.eraseMode).toBe(true);
  });
});

describe('Material brush settings', () => {
  it('writes what the next stroke paints with', () => {
    expect(useStore.getState().tools.settings.material.floor).toBe(true);
    expect(settings.setSetting('material.size', 4)).toBe(true);
    expect(settings.setSetting('material.smooth', false)).toBe(true);
    expect(settings.setSetting('material.border', false)).toBe(true);
    expect(settings.setSetting('material.floor', false)).toBe(true);
    expect(useStore.getState().tools.settings.material).toMatchObject({ material: 'GG_Cave_Ink', radius: 4, smooth: false, border: false, floor: false });
    expect(settings.setSetting('material.size', 40)).toBe(false);
    // The height new pieces take: half steps, 0 stored as nothing.
    expect(settings.getSetting('material.height')).toBe(0);
    expect(settings.setSetting('material.height', -1.5)).toBe(true);
    expect(useStore.getState().tools.settings.material.height).toBe(-1.5);
    settings.setSetting('material.height', 0);
    expect(useStore.getState().tools.settings.material.height).toBeUndefined();
  });

  it('says on the status bar whether the stroke paints a cave floor or a piece', () => {
    useStore.getState().setActiveTool('material');
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    const setFloor = (floor: boolean) =>
      useStore.setState((s) => {
        s.tools.settings.material.floor = floor;
      });
    setFloor(true);
    expect(hint()).toBe('Paint a cave floor · release to close it · Alt erase');
    setFloor(false);
    expect(hint()).toBe('Paint a piece · release to close it · Alt erase');
  });

  it('offers Rock on cut edge only while erasing a cave’s real floor, off unless set, and the hint says what Erase does there', () => {
    useStore.getState().setActiveTool('material');
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    const shown = () => reg.settingById('material.rockOnCut')!.visibleWhen!((k) => settings.getSetting(k));
    expect(reg.settingById('material.rockOnCut')).toMatchObject({ label: 'Rock on cut edge', control: 'switch', section: 'Mode', default: false });
    expect(shown()).toBe(false);
    useStore.getState().setEraseMode(true);
    expect(shown()).toBe(true);
    expect(settings.getSetting('material.rockOnCut')).toBe(false);
    expect(hint()).toBe('Erase across the rock to open the cave · [ ] size');
    expect(settings.setSetting('material.rockOnCut', true)).toBe(true);
    expect(useStore.getState().tools.settings.material.rockOnCut).toBe(true);
    expect(hint()).toBe('Carve the floor · [ ] size');
    // A ground piece, or a plain texture, has no rock to open.
    useStore.setState((s) => {
      s.tools.settings.material.floor = false;
    });
    expect(shown()).toBe(false);
    expect(hint()).toBe('Erase the top piece, or the selected one · [ ] size');
    useStore.setState((s) => {
      s.tools.settings.material.floor = true;
      s.tools.settings.material.material = DIRT;
    });
    expect(shown()).toBe(false);
  });

  it('hides Border and Paint a real floor for a plain floor texture, which paints a ground piece', () => {
    useStore.getState().setActiveTool('material');
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    const shown = (id: string) => reg.settingById(id)!.visibleWhen!((k) => settings.getSetting(k));
    expect(shown('material.border')).toBe(true);
    expect(shown('material.floor')).toBe(true);
    useStore.setState((s) => {
      s.tools.settings.material.material = DIRT;
      s.tools.settings.material.floor = true;
    });
    expect(shown('material.border')).toBe(false);
    expect(shown('material.floor')).toBe(false);
    expect(hint()).toBe('Paint a piece · release to close it · Alt erase');
  });

  it('offers Paint a real floor only for a band set with Border on, and Feather only where it does something', () => {
    useStore.getState().setActiveTool('material');
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    const shown = (id: string) => reg.settingById(id)!.visibleWhen!((k) => settings.getSetting(k));
    const set = (patch: { material?: string; border?: boolean; floor?: boolean }) =>
      useStore.setState((s) => {
        Object.assign(s.tools.settings.material, patch);
      });
    // A band set with Border on: a walled floor, whose edge is its rock, so no Feather.
    set({ material: 'GG_Cave_Ink', border: true, floor: true });
    expect(shown('material.floor')).toBe(true);
    expect(shown('material.feather')).toBe(false);
    expect(hint()).toBe('Paint a cave floor · release to close it · Alt erase');
    // Border off: a ground piece of the fill, whatever Paint a real floor says.
    set({ border: false });
    expect(shown('material.floor')).toBe(false);
    expect(shown('material.feather')).toBe(true);
    expect(hint()).toBe('Paint a piece · release to close it · Alt erase');
    // A plain texture feathers.
    set({ material: DIRT, border: true });
    expect(shown('material.feather')).toBe(true);
    // Erasing, Feather always shows.
    set({ material: 'GG_Cave_Ink', border: true });
    useStore.getState().setEraseMode(true);
    expect(shown('material.feather')).toBe(true);
  });

  it('says when the erase keeps to the selected piece, and that Escape lets it go', () => {
    useStore.getState().setActiveTool('material');
    useStore.getState().setEraseMode(true);
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.setState((s) => {
      (s.layers.find((l) => l.id === layer.id) as DungeonLayer).children = [
        { id: 'p', name: 'Grass 1', childType: 'shape', visible: true, shapeType: 'polygon', contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff', ground: true },
      ];
      s.ui.activeLayerId = layer.id;
      s.selection.selectedIds = ['p'];
    });
    expect(hint()).toBe('Erasing only the selected piece · [ ] size · Esc erase anything');
    useStore.getState().setSelectedIds([]);
    expect(hint()).not.toContain('Erasing only');
  });

  it('shows Shore, Shore width and Shallow line with water in hand, under any entry, and writes them for the next piece', () => {
    withGroundPack(() => {
      useStore.getState().setActiveTool('material');
      const shown = (id: string) => reg.settingById(id)!.visibleWhen!((k) => settings.getSetting(k));
      const water = ['material.shore', 'material.shoreWidth', 'material.shallowLine'];
      for (const id of water) expect(shown(id), id).toBe(false);
      useStore.setState((s) => {
        s.tools.settings.material.material = WATER;
      });
      for (const id of water) expect(shown(id), id).toBe(true);
      // The Water entry has water in hand from the start; the Terrain entry does not.
      useStore.getState().setActiveTool('water');
      for (const id of water) expect(shown(id), id).toBe(true);
      useStore.getState().setActiveTool('terrain');
      for (const id of water) expect(shown(id), id).toBe(false);
      expect(settings.getSetting('material.shore')).toBe('');
      expect(settings.getSetting('material.shoreWidth')).toBe(0.5);
      expect(settings.setSetting('material.shore', 'none')).toBe(true);
      expect(settings.setSetting('material.shoreWidth', 1.25)).toBe(true);
      expect(settings.setSetting('material.shallowLine', true)).toBe(true);
      expect(useStore.getState().tools.settings.material).toMatchObject({ shore: 'none', shoreWidth: 1.25, shallowLine: true });
      // Picking the default dirt again stores nothing.
      settings.setSetting('material.shore', DIRT);
      expect(useStore.getState().tools.settings.material.shore).toBeUndefined();
      expect(settings.setSetting('material.shoreWidth', 3)).toBe(false);
    });
  });
});

describe('Path settings and card', () => {
  it('keeps Width, Smoothness, Curve and Node mode and the pieces in the dock; the ends, Snap and Block light in the panel', () => {
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('path', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['path.width', 'path.smoothness', 'edit.curve', 'edit.nodeMode']);
    expect(ids('panel')).toEqual(['path.transitionIn', 'path.transitionOut', 'grid.snap', 'path.blocksLight']);
    expect(reg.toolById('path')!.dock.map((c) => c.id)).toEqual(['path.pieces']);
    expect(reg.settingById('path.transitionIn')?.options?.map((o) => o.label)).toEqual(['Hard', 'Fade', 'Grow']);
    expect(reg.settingById('path.transitionOut')?.options?.map((o) => o.label)).toEqual(['Hard', 'Fade', 'Shrink']);
  });

  it('writes what the next path is drawn with', () => {
    expect(settings.setSetting('path.width', 2.5)).toBe(true);
    expect(settings.setSetting('path.smoothness', 0.2)).toBe(true);
    expect(settings.setSetting('path.transitionIn', 'grow')).toBe(true);
    expect(settings.setSetting('path.transitionOut', 'grow')).toBe(false);
    expect(useStore.getState().tools.settings.path).toMatchObject({ width: 2.5, smoothness: 0.2, transitionIn: 'grow' });
  });

  it('edits a placed path from its card, Node mode first on its row', () => {
    const card = reg.cardForKind('pathway')!;
    expect(card.fields.map((f) => f.label)).toEqual(['Width', 'Smoothness', 'Transition in', 'Transition out', 'Block light']);
    expect(card.verbs[0].id).toBe('nodeMode');
    const layerId = useStore.getState().ui.activeLayerId;
    useStore.getState().addChild(layerId, {
      id: 'p1', name: 'Path', childType: 'pathway', visible: true, contours: [[[0, 0], [4, 0]]],
      pieceId: 'x', width: 1, smoothness: 0.6, curve: false, transitionIn: 'fade', transitionOut: 'hard', blocksLight: false,
    });
    undoManager.clear();
    card.fields.find((f) => f.label === 'Width')!.write(useStore, ['p1'], 3);
    const read = () => (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer).children.find((c) => c.id === 'p1');
    expect(read()).toMatchObject({ width: 3 });
    undoManager.undo();
    expect(read()).toMatchObject({ width: 1 });
    // Node mode opens the picked path's nodes, and the shared switch reads it.
    useStore.setState((s) => {
      s.selection.selectedIds = ['p1'];
    });
    expect(card.verbs[0].when?.(useStore.getState())).toBe(true);
    card.verbs[0].run(useStore);
    expect(useStore.getState().tools.pathNodeEditId).toBe('p1');
    expect(settings.getSetting('edit.nodeMode')).toBe(true);
    settings.setSetting('edit.nodeMode', false);
    expect(useStore.getState().tools.pathNodeEditId).toBeNull();
  });
});
