import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { bindingOf, createRegistry } from './index';
import { createSettings, TOOL_SETTINGS_KEY } from './settings';
import { fixtureInput, otherTool, shapeTool } from './registry.fixture';
import { gridSnap } from './shared';

const reg = createRegistry(fixtureInput());
const settings = createSettings(reg, useStore);
const tools = () => useStore.getState().tools;

beforeEach(() => {
  localStorage.clear();
  useStore.getState().resetToDefault();
  useStore.getState().setSnapEnabled(true);
});

afterEach(() => vi.restoreAllMocks());

describe('setSetting', () => {
  it('writes a value that parses into the core field and reads it back', () => {
    expect(settings.setSetting('fixture.sides', 6)).toBe(true);
    expect(tools().settings.regularPolygon.sides).toBe(6);
    expect(settings.getSetting('fixture.sides')).toBe(6);

    expect(settings.setSetting('fixture.scaleRange', [0.5, 2])).toBe(true);
    expect(tools().settings.scatterBrush.scaleRange).toEqual([0.5, 2]);
  });

  it('refuses a value that does not parse and leaves the store alone', () => {
    expect(settings.setSetting('fixture.sides', 2)).toBe(false);
    expect(settings.setSetting('fixture.sides', 'six')).toBe(false);
    expect(settings.setSetting('fixture.scaleRange', [2, 1])).toBe(false);
    expect(tools().settings.regularPolygon.sides).toBe(4);
    expect(tools().settings.scatterBrush.scaleRange).toEqual([0.8, 1.2]);
  });

  it('refuses an unknown id', () => {
    expect(settings.setSetting('fixture.nothing', 1)).toBe(false);
    expect(settings.getSetting('fixture.nothing')).toBeUndefined();
  });

  it('warns once per setting in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    settings.setSetting('fixture.scale', 99);
    settings.setSetting('fixture.scale', -1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('turns node mode on only for one picked floor or wall', () => {
    expect(settings.setSetting('edit.nodeMode', true)).toBe(true);
    expect(settings.getSetting('edit.nodeMode')).toBe(false);
  });
});

describe('shared settings', () => {
  it('are written once and read back through every tool that lists them', () => {
    expect(settings.setSetting('grid.snap', false)).toBe(true);
    expect(useStore.getState().grid.snapEnabled).toBe(false);
    for (const tool of [shapeTool, otherTool]) {
      const def = reg.settingsByHome(tool.id, 'panel').find((s) => s.id === 'grid.snap');
      expect(def).toBe(gridSnap);
      expect(bindingOf(def!).read(useStore.getState())).toBe(false);
    }
  });
});

describe('resetTool', () => {
  it('puts the tool back to its defaults', () => {
    settings.setSetting('fixture.sides', 9);
    settings.setSetting('fixture.secret', true);
    settings.setSetting('fixture.scaleRange', [1, 3]);
    settings.resetTool('fixture');
    expect(settings.getSetting('fixture.sides')).toBe(4);
    expect(settings.getSetting('fixture.secret')).toBe(false);
    expect(settings.getSetting('fixture.scaleRange')).toEqual([0.8, 1.2]);
  });

  it('leaves settings that are not saved, such as curve and snap', () => {
    settings.setSetting('edit.curve', true);
    settings.setSetting('grid.snap', false);
    settings.resetTool('fixture');
    expect(tools().curveMode).toBe(true);
    expect(useStore.getState().grid.snapEnabled).toBe(false);
  });
});

describe('prefs', () => {
  it('load the values that parse and drop the rest', () => {
    const dropped = settings.loadPrefs({
      'fixture.sides': 8,
      'fixture.secret': 'yes',
      'fixture.scale': 99,
      'fixture.gone': 1,
      'edit.curve': true,
    });
    expect(dropped).toEqual(['fixture.secret', 'fixture.scale', 'fixture.gone', 'edit.curve']);
    expect(settings.getSetting('fixture.sides')).toBe(8);
    expect(settings.getSetting('fixture.secret')).toBe(false);
    expect(settings.getSetting('fixture.scale')).toBe(1);
    expect(tools().curveMode).toBe(false);
  });

  it('ignore saved data that is not an object', () => {
    expect(settings.loadPrefs('nonsense')).toEqual([]);
    expect(settings.loadPrefs([1, 2])).toEqual([]);
    expect(settings.loadPrefs(null)).toEqual([]);
  });

  it('save only what differs from the default', () => {
    settings.setSetting('fixture.sides', 5);
    settings.setSetting('edit.curve', true);
    expect(settings.prefsSnapshot()).toEqual({ 'fixture.sides': 5 });
  });

  it('round-trip through storage and survive a new map', () => {
    localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({ 'fixture.sides': 7, 'fixture.secret': 'bad' }));
    const stop = settings.initPrefs();
    try {
      expect(settings.getSetting('fixture.sides')).toBe(7);
      expect(settings.getSetting('fixture.secret')).toBe(false);

      settings.setSetting('fixture.secret', true);
      expect(JSON.parse(localStorage.getItem(TOOL_SETTINGS_KEY)!)).toEqual({ 'fixture.sides': 7, 'fixture.secret': true });

      useStore.getState().resetToDefault();
      expect(settings.getSetting('fixture.sides')).toBe(7);
      expect(settings.getSetting('fixture.secret')).toBe(true);
    } finally {
      stop();
    }
  });
});
