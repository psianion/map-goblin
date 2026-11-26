import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store/store';
import { initDoorStylePref } from './doorStylePref';

const door = () => {
  const { doorStyle, doorBare, doorStairs } = useStore.getState().tools.settings;
  return { doorStyle, doorBare, doorStairs };
};

describe('door style for the session', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    sessionStorage.clear();
    useStore.getState().resetToDefault();
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('comes back after a reload', () => {
    stop = initDoorStylePref();
    useStore.getState().updateToolSettings({ doorStyle: 'double', doorStairs: true });
    stop();
    useStore.getState().resetToDefault();
    stop = initDoorStylePref();
    expect(door()).toMatchObject({ doorStyle: 'double', doorStairs: true });
  });

  it('survives a new map', () => {
    stop = initDoorStylePref();
    useStore.getState().updateToolSettings({ doorStyle: 'archway', doorBare: true });
    useStore.getState().resetToDefault();
    expect(door()).toMatchObject({ doorStyle: 'archway', doorBare: true });
  });
});
