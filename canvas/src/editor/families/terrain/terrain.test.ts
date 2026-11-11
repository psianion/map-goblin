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
import { fromHex8, toHex8 } from './colour';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import { emptyWaterGrid, encodeWater, paintWaterDisc } from '@dnd/core/src/shared/waterMask';

const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);
const brush = () => useStore.getState().tools.settings.terrainBrush;

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

  it('keeps Size, Intensity and the slots in the dock; Paint or erase, the blending, Fill and the colour in the panel', () => {
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('terrainBrush', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['terrain.size', 'terrain.strength']);
    expect(ids('panel')).toEqual(['terrain.mode', 'terrain.smoothBlend', 'terrain.fill', 'terrain.colour']);
    // The id and the store field stay, so saved prefs load; only the label is new.
    expect(reg.settingById('terrain.strength')?.label).toBe('Intensity');
    expect(reg.toolById('terrainBrush')!.dock.map((c) => c.id)).toEqual(['terrain.slots']);
  });

  it('parses every default', () => {
    for (const d of terrain.tools.flatMap((t) => t.settings)) expect(d.schema.safeParse(d.default).success, d.id).toBe(true);
  });
});

describe('Terrain brush settings', () => {
  it('writes size and strength into the brush, refusing what is out of range', () => {
    expect(settings.setSetting('terrain.size', 4.5)).toBe(true);
    expect(settings.setSetting('terrain.strength', 0.3)).toBe(true);
    expect(brush()).toMatchObject({ radius: 4.5, strength: 0.3 });
    expect(settings.setSetting('terrain.size', 40)).toBe(false);
    expect(settings.setSetting('terrain.strength', 0)).toBe(false);
  });

  it('writes one colour with alpha as the tint and its opacity, alpha 0 untinted', () => {
    expect(settings.getSetting('terrain.colour')).toBe('#ffffff00');
    expect(settings.setSetting('terrain.colour', '#33669980')).toBe(true);
    expect(brush().tintColor).toBe('#336699');
    expect(brush().tintOpacity).toBeCloseTo(0.5, 2);
    // A colour at alpha 0 stays untinted: the store no longer lifts it on its own.
    settings.setSetting('terrain.colour', '#aa000000');
    expect(brush()).toMatchObject({ tintColor: '#aa0000', tintOpacity: 0 });
    expect(settings.setSetting('terrain.colour', '#336699')).toBe(false);
  });

  it('picks Erase on the Mode seg, the erase mode Scatter shares', () => {
    const hint = () => reg.toolById('terrainBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    expect(hint()).toBe('Hold to build up · Alt erase · [ ] size');
    settings.setSetting('terrain.mode', true);
    expect(useStore.getState().tools.eraseMode).toBe(true);
    expect(hint()).toMatch(/^Hold to erase/);
  });

  it('saves Smooth blending on the terrain, with the map', () => {
    expect(settings.getSetting('terrain.smoothBlend')).toBe(false);
    settings.setSetting('terrain.smoothBlend', true);
    expect(useStore.getState().mapSettings.terrain?.smoothBlend).toBe(true);
    expect(useStore.getState().getSerializableState().mapSettings.terrain?.smoothBlend).toBe(true);
  });

  it('arms Fill as a one-shot that another tool or Escape puts down', () => {
    const hint = () => reg.toolById('terrainBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    settings.setSetting('terrain.fill', true);
    expect(useStore.getState().tools.terrainFill).toBe('armed');
    expect(hint()).toBe('Click a floor to fill · Esc cancels');
    useStore.getState().setTerrainFill('miss');
    expect(settings.getSetting('terrain.fill')).toBe(true);
    expect(hint()).toBe('No floor here · Esc cancels');
    useStore.getState().setActiveTool('select');
    expect(useStore.getState().tools.terrainFill).toBe('off');
  });

  it('round-trips the colour through #rrggbbaa', () => {
    expect(fromHex8(toHex8('#FFDD88', 0.6))).toEqual({ colour: '#ffdd88', alpha: 0.6 });
  });
});

describe('Water brush settings', () => {
  beforeEach(() => undoManager.clear());
  const layer = () => useStore.getState().layers.find((l) => l.id === useStore.getState().ui.activeLayerId) as DungeonLayer;

  it('keeps Size and Brush or Shape in the dock, the mode, colours, blend and border in the panel', () => {
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('waterBrush', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['water.size', 'water.place']);
    expect(ids('panel')).toEqual(['terrain.mode', 'water.shallow', 'water.deep', 'water.blend', 'water.border']);
    const place = reg.settingById('water.place')!;
    expect(place.options?.map((o) => [o.label, o.disabled === true])).toEqual([['Brush', false], ['Shape', true]]);
    expect(settings.setSetting('water.place', 'shape')).toBe(true);
    expect(settings.getSetting('water.place')).toBe('brush');
  });

  it('sets the first stroke\'s look on a dry layer, without an undo step', () => {
    expect(settings.setSetting('water.deep', '#112233')).toBe(true);
    expect(useStore.getState().tools.settings.water.deep).toBe('#112233');
    expect(layer().water).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });

  it('changes the look of the water on the layer in hand as one undo step', () => {
    const body = encodeWater(paintWaterDisc(emptyWaterGrid(), 0, 0, 2, false), useStore.getState().tools.settings.water)!;
    useStore.getState().updateLayer(layer().id, { water: body });
    expect(settings.getSetting('water.deep')).toBe('#5f8a93');
    settings.setSetting('water.deep', '#223344');
    settings.setSetting('water.deep', '#334455');
    expect(layer().water?.deep).toBe('#334455');
    expect(settings.getSetting('water.deep')).toBe('#334455');
    undoManager.undo();
    expect(layer().water?.deep).toBe('#5f8a93');
    expect(layer().water?.runs).toBe(body.runs);
  });

  it('says how to paint and erase on the status bar', () => {
    const hint = () => reg.toolById('waterBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    expect(hint()).toBe('Paint water · Alt erase · [ ] size');
    settings.setSetting('terrain.mode', true);
    expect(hint()).toBe('Erase water · [ ] size');
  });
});

describe('Material brush settings', () => {
  it('keeps Size and the swatches in the dock, the mode, Smooth, Border and the wall switch in the panel', () => {
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('materialBrush', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['material.size']);
    expect(ids('panel')).toEqual(['terrain.mode', 'material.smooth', 'material.border', 'material.wall']);
    expect(reg.settingById('material.wall')).toMatchObject({ label: 'Edge is a wall', control: 'switch', section: 'Outline', default: true });
    expect(reg.toolById('materialBrush')!.dock.map((c) => c.id)).toEqual(['material.swatches']);
  });

  it('writes what the next stroke paints with', () => {
    expect(useStore.getState().tools.settings.material.wall).toBe(true);
    expect(settings.setSetting('material.size', 4)).toBe(true);
    expect(settings.setSetting('material.smooth', false)).toBe(true);
    expect(settings.setSetting('material.border', false)).toBe(true);
    expect(settings.setSetting('material.wall', false)).toBe(true);
    expect(useStore.getState().tools.settings.material).toMatchObject({ material: 'GG_Cave_Ink', radius: 4, smooth: false, border: false, wall: false });
    expect(settings.setSetting('material.size', 40)).toBe(false);
  });

  it('says how to paint a patch on the status bar', () => {
    const hint = () => reg.toolById('materialBrush')!.hint(useStore.getState()).segments.map((s) => s.text).join('');
    expect(hint()).toBe('Paint a patch · release to close it · Alt erase');
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
