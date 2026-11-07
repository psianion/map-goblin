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

  it('holds the Terrain brush under T, key B, driving the terrain tool', () => {
    expect([terrain.key, terrain.tools.map((t) => [t.label, t.key, t.engine])]).toEqual(['T', [['Terrain brush', 'B', ['terrain']]]]);
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
