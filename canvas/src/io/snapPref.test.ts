import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { initSnapPref, loadSnapPref, saveSnapPref, SNAP_PREF_KEY } from './snapPref';

const snap = () => useStore.getState().grid.snapEnabled;

describe('snap preference', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setSnapEnabled(true);
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('defaults to on when nothing is saved', () => {
    expect(loadSnapPref()).toBeNull();
    stop = initSnapPref();
    expect(snap()).toBe(true);
    expect(localStorage.getItem(SNAP_PREF_KEY)).toBeNull();
  });

  it('applies a saved off at boot', () => {
    saveSnapPref(false);
    stop = initSnapPref();
    expect(snap()).toBe(false);
  });

  it('writes every change back', () => {
    stop = initSnapPref();
    useStore.getState().setSnapEnabled(false);
    expect(localStorage.getItem(SNAP_PREF_KEY)).toBe('false');
    useStore.getState().setSnapEnabled(true);
    expect(localStorage.getItem(SNAP_PREF_KEY)).toBe('true');
  });

  it('survives opening a map and starting a new one', () => {
    saveSnapPref(false);
    stop = initSnapPref();
    useStore.getState().loadFromFile(useStore.getState().getSerializableState());
    expect(snap()).toBe(false);
    useStore.getState().resetToDefault();
    expect(snap()).toBe(false);
    expect(localStorage.getItem(SNAP_PREF_KEY)).toBe('false');
  });

  it('stops writing once unsubscribed', () => {
    stop = initSnapPref();
    stop();
    stop = null;
    useStore.getState().setSnapEnabled(false);
    expect(localStorage.getItem(SNAP_PREF_KEY)).toBeNull();
  });

  it('ignores a foreign value', () => {
    localStorage.setItem(SNAP_PREF_KEY, '{not a bool');
    expect(loadSnapPref()).toBeNull();
    localStorage.setItem(SNAP_PREF_KEY, '0');
    expect(loadSnapPref()).toBeNull();
  });
});
