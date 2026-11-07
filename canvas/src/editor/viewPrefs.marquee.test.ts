import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { MARQUEE_FILTER_KEY, initMarqueePrefs, loadMarqueeFilter, resetViewPrefsForTests } from './viewPrefs';

beforeEach(() => {
  localStorage.clear();
  resetViewPrefsForTests();
  useStore.getState().resetToDefault();
});
afterEach(() => resetViewPrefsForTests());

describe('marquee filter preference', () => {
  it('is Everything with nothing (or nothing valid) saved', () => {
    expect(loadMarqueeFilter()).toBe('all');
    localStorage.setItem(MARQUEE_FILTER_KEY, 'bogus');
    expect(loadMarqueeFilter()).toBe('all');
  });

  it('puts the saved choice in the store, remembers a change, and survives a new map', () => {
    localStorage.setItem(MARQUEE_FILTER_KEY, 'tab');
    initMarqueePrefs();
    expect(useStore.getState().ui.marqueeFilter).toBe('tab');
    useStore.getState().setMarqueeFilter('all');
    expect(localStorage.getItem(MARQUEE_FILTER_KEY)).toBe('all');
    useStore.getState().setMarqueeFilter('tab');
    useStore.getState().resetToDefault();
    expect(useStore.getState().ui.marqueeFilter).toBe('tab');
  });
});
