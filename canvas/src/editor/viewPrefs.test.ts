import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { lightPreset, presetDefaults } from '@dnd/core/src/store/lightPresets';
import {
  FOCUS_MODE_KEY,
  LEGACY_FOCUS_MODE_KEY,
  LIGHT_BRUSH_KEY,
  LIT_PREVIEW_KEY,
  PROP_PREFS_KEY,
  getLitPreview,
  initFocusMode,
  initLightBrush,
  initPropPrefs,
  loadLightBrush,
  loadPropPrefs,
  loadFocusMode,
  nextFocusMode,
  resetViewPrefsForTests,
  setLitPreview,
  toggleLitPreview,
} from './viewPrefs';

beforeEach(() => {
  localStorage.clear();
  resetViewPrefsForTests();
  useStore.getState().resetToDefault();
});

afterEach(() => {
  resetViewPrefsForTests();
});

describe('focus mode', () => {
  it('is Auto with nothing saved', () => {
    expect(loadFocusMode()).toBe('auto');
  });

  it('reads the saved mode', () => {
    localStorage.setItem(FOCUS_MODE_KEY, 'fullscreen');
    expect(loadFocusMode()).toBe('fullscreen');
  });

  it('ignores a value it does not know', () => {
    localStorage.setItem(FOCUS_MODE_KEY, 'sideways');
    expect(loadFocusMode()).toBe('auto');
  });

  it('moves the old key over once', () => {
    localStorage.setItem(LEGACY_FOCUS_MODE_KEY, 'manual');
    expect(loadFocusMode()).toBe('manual');
    expect(localStorage.getItem(FOCUS_MODE_KEY)).toBe('manual');
    expect(localStorage.getItem(LEGACY_FOCUS_MODE_KEY)).toBeNull();
  });

  it('prefers the new key over the old one', () => {
    localStorage.setItem(FOCUS_MODE_KEY, 'fullscreen');
    localStorage.setItem(LEGACY_FOCUS_MODE_KEY, 'manual');
    expect(loadFocusMode()).toBe('fullscreen');
  });

  it('cycles Auto, Manual, Fullscreen and round again', () => {
    expect(nextFocusMode('auto')).toBe('manual');
    expect(nextFocusMode('manual')).toBe('fullscreen');
    expect(nextFocusMode('fullscreen')).toBe('auto');
  });

  it('comes up in the saved mode instead of overwriting it with the default', () => {
    localStorage.setItem(FOCUS_MODE_KEY, 'manual');
    initFocusMode();
    expect(useStore.getState().ui.focusMode).toBe('manual');
    expect(localStorage.getItem(FOCUS_MODE_KEY)).toBe('manual');
  });

  it('remembers a change', () => {
    initFocusMode();
    useStore.getState().setFocusMode('fullscreen');
    expect(localStorage.getItem(FOCUS_MODE_KEY)).toBe('fullscreen');
  });

  it('keeps the chosen mode through a store reset (a new map)', () => {
    initFocusMode();
    useStore.getState().setFocusMode('manual');
    useStore.getState().resetToDefault();
    expect(useStore.getState().ui.focusMode).toBe('manual');
    expect(localStorage.getItem(FOCUS_MODE_KEY)).toBe('manual');
  });

  it('starts only once', () => {
    localStorage.setItem(FOCUS_MODE_KEY, 'manual');
    initFocusMode();
    useStore.getState().setFocusMode('fullscreen');
    initFocusMode();
    expect(useStore.getState().ui.focusMode).toBe('fullscreen');
  });
});

describe('lit preview', () => {
  it('is off by default', () => {
    expect(getLitPreview()).toBe(false);
  });

  it('is remembered', () => {
    setLitPreview(true);
    expect(localStorage.getItem(LIT_PREVIEW_KEY)).toBe('1');
    resetViewPrefsForTests();
    expect(getLitPreview()).toBe(true);
  });

  it('toggles and reports the new value', () => {
    expect(toggleLitPreview()).toBe(true);
    expect(toggleLitPreview()).toBe(false);
    expect(localStorage.getItem(LIT_PREVIEW_KEY)).toBe('0');
  });
});

describe('prop view', () => {
  const seeUnder = () => useStore.getState().ui.seeUnderOverhead;
  const setSeeUnder = (on: boolean) => useStore.getState().setSeeUnderOverhead(on);

  it('is off with nothing saved, and ignores a value it does not know', () => {
    expect(loadPropPrefs()).toEqual({});
    localStorage.setItem(PROP_PREFS_KEY, JSON.stringify({ seeUnderOverhead: 'yes' }));
    expect(loadPropPrefs()).toEqual({});
    localStorage.setItem(PROP_PREFS_KEY, '{oops');
    expect(loadPropPrefs()).toEqual({});
    initPropPrefs();
    expect(seeUnder()).toBe(false);
  });

  it('comes up as saved and remembers a change', () => {
    localStorage.setItem(PROP_PREFS_KEY, JSON.stringify({ seeUnderOverhead: true }));
    initPropPrefs();
    expect(seeUnder()).toBe(true);
    setSeeUnder(false);
    expect(JSON.parse(localStorage.getItem(PROP_PREFS_KEY) ?? '{}')).toEqual({ seeUnderOverhead: false });
  });

  it('keeps the choice through a store reset (a new map)', () => {
    initPropPrefs();
    setSeeUnder(true);
    useStore.getState().resetToDefault();
    expect(seeUnder()).toBe(true);
    expect(JSON.parse(localStorage.getItem(PROP_PREFS_KEY) ?? '{}')).toEqual({ seeUnderOverhead: true });
  });
});

describe('light brush', () => {
  const brush = () => useStore.getState().tools.settings.lightDefaults;
  const torch = presetDefaults(lightPreset('torch'));
  const saved = () => JSON.parse(localStorage.getItem(LIGHT_BRUSH_KEY) ?? '{}');

  it('is the Torch preset with nothing saved, not the tool default', () => {
    expect(loadLightBrush()).toEqual(torch);
    initLightBrush();
    expect(brush()).toMatchObject({ presetId: 'torch', featherRadius: 4, radius: 8, color: torch.color, intensity: 0.9 });
    expect(brush().animation).toEqual({ kind: 'flicker', speed: 1 });
  });

  it('ignores a value it does not know', () => {
    for (const raw of ['{oops', '[]', '"torch"', JSON.stringify({ ...torch, radius: 'big' }), JSON.stringify({ ...torch, color: 5 }), JSON.stringify({ ...torch, falloff: 'cubic' })]) {
      localStorage.setItem(LIGHT_BRUSH_KEY, raw);
      expect(loadLightBrush()).toEqual(torch);
    }
    // An optional field holding nonsense is dropped; the rest of the brush stands.
    localStorage.setItem(LIGHT_BRUSH_KEY, JSON.stringify({ ...torch, presetId: 'lamp', animation: { kind: 'strobe', speed: 1 }, cone: 'wide', darkness: 'no' }));
    expect(loadLightBrush()).toEqual({ ...torch, presetId: undefined, animation: undefined, darkness: undefined });
  });

  it('remembers a change and comes back with it after a reload', () => {
    initLightBrush();
    useStore.getState().updateLightDefaults({ featherRadius: 6, radius: 12, color: '#9ec8ff', cone: { angle: 90, direction: 0 } });
    expect(saved()).toMatchObject({ featherRadius: 6, radius: 12, color: '#9ec8ff', cone: { angle: 90, direction: 0 } });

    resetViewPrefsForTests();
    useStore.getState().resetToDefault();
    initLightBrush();
    expect(brush()).toMatchObject({ featherRadius: 6, radius: 12, color: '#9ec8ff', cone: { angle: 90, direction: 0 } });
  });

  it('keeps the brush through a store reset (a new map)', () => {
    initLightBrush();
    useStore.getState().updateLightDefaults(presetDefaults(lightPreset('lantern')));
    useStore.getState().resetToDefault();
    expect(brush()).toMatchObject({ presetId: 'lantern', featherRadius: 6, radius: 12 });
    expect(saved()).toMatchObject({ presetId: 'lantern' });
  });
});
