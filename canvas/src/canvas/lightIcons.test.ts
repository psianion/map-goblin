// View > Light icons: the pref, which bulbs show, and which lights a click can still pick.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import type { DungeonLayer, LightChild } from '@/store/types';
import { lightPickable, pickAt } from '@dnd/core/src/engine/hitTest';
import { getLightIcons, LIGHT_ICONS_KEY, resetViewPrefsForTests, setLightIcons } from '@/editor/viewPrefs';
import { lightIconRule, mountLightIcons, showsIcon } from './lightIcons';

const light = (id: string, x: number): LightChild =>
  ({
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius: 4,
    featherRadius: 2,
    intensity: 1,
    falloff: 'quadratic',
    position: { x, y: 2 },
  }) as LightChild;

beforeEach(() => {
  localStorage.clear();
  resetViewPrefsForTests();
  useStore.getState().resetToDefault();
  // The tool in hand outlives a reset: start every case with Select.
  useStore.getState().setActiveTool('select');
});

describe('the Light icons pref', () => {
  it('is on by default, remembered off in this browser, and read back after a reload', () => {
    expect(getLightIcons()).toBe(true);
    setLightIcons(false);
    expect(localStorage.getItem(LIGHT_ICONS_KEY)).toBe('off');
    resetViewPrefsForTests();
    expect(getLightIcons()).toBe(false);
  });

  it('stays on when storage cannot be read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    resetViewPrefsForTests();
    expect(getLightIcons()).toBe(true);
    spy.mockRestore();
  });
});

describe('lightIconRule', () => {
  it('shows every bulb with the pref on, whatever is in hand or picked', () => {
    expect(lightIconRule(true, 'select', [])).toMatchObject({ all: true });
  });

  it('shows every bulb with the Light tool in hand, even with the pref off', () => {
    expect(lightIconRule(false, 'light', [])).toMatchObject({ all: true });
  });

  it('with the pref off, keeps only the selected light`s bulb', () => {
    const rule = lightIconRule(false, 'select', ['a']);
    expect(rule.all).toBe(false);
    expect(showsIcon(rule, { id: 'a' })).toBe(true);
    expect(showsIcon(rule, { id: 'b' })).toBe(false);
  });
});

describe('mountLightIcons', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  function seed(): void {
    const layer = { ...createDungeonLayer('L'), children: [light('a', 2), light('b', 20)] } as DungeonLayer;
    useStore.setState((s) => {
      s.layers = [layer];
    });
  }

  it('hides the renderer`s bulbs and their click targets with the pref off, all but the selected light', () => {
    seed();
    const setIconsVisible = vi.fn();
    stop = mountLightIcons({ setIconsVisible });
    expect(setIconsVisible).toHaveBeenLastCalledWith(true, []);
    expect(pickAt([2, 2], { zoom: 1 })).toMatchObject({ kind: 'child', child: { id: 'a' } });

    setLightIcons(false);
    expect(setIconsVisible).toHaveBeenLastCalledWith(false, []);
    const hit = pickAt([2, 2], { zoom: 1 });
    expect(hit?.kind === 'child' ? hit.child.id : null).not.toBe('a');
    expect(lightPickable(light('a', 2))).toBe(false);

    useStore.getState().setSelectedIds(['b']);
    expect(setIconsVisible).toHaveBeenLastCalledWith(false, ['b']);
    expect(lightPickable(light('b', 20))).toBe(true);
    expect(lightPickable(light('a', 2))).toBe(false);

    useStore.getState().setActiveTool('light');
    expect(setIconsVisible).toHaveBeenLastCalledWith(true, []);
    expect(lightPickable(light('a', 2))).toBe(true);
  });

  it('puts every light back in reach when it unmounts', () => {
    seed();
    setLightIcons(false);
    stop = mountLightIcons({ setIconsVisible: vi.fn() });
    expect(lightPickable(light('a', 2))).toBe(false);
    stop();
    stop = null;
    expect(lightPickable(light('a', 2))).toBe(true);
  });
});
