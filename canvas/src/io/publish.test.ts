import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashMapForPublish,
  getPublishToken,
  setPublishToken,
  clearPublishToken,
} from './publish';
import type { SerializedMapData } from '@/store/types';

const BASE_DATA: SerializedMapData = {
  version: '2.0',
  mapSettings: {
    name: 'Test Dungeon',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
  },
  grid: { visible: true, snapDivision: 2 },
  layers: [],
  customImages: {},
};

describe('hashMapForPublish', () => {
  it('is stable across prep-only changes', async () => {
    const withoutPrep = { ...BASE_DATA };
    const withPrep: SerializedMapData = {
      ...BASE_DATA,
      prep: { version: 1, triggers: [] },
    };
    const hashA = await hashMapForPublish(withoutPrep);
    const hashB = await hashMapForPublish(withPrep);
    expect(hashA).toBe(hashB);
  });

  it('changes when map geometry changes', async () => {
    const before = await hashMapForPublish(BASE_DATA);
    const after = await hashMapForPublish({
      ...BASE_DATA,
      mapSettings: { ...BASE_DATA.mapSettings, name: 'Renamed Dungeon' },
    });
    expect(before).not.toBe(after);
  });

  it('produces a 64-char hex sha-256 digest', async () => {
    const hash = await hashMapForPublish(BASE_DATA);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('publish token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a token per campaign', () => {
    expect(getPublishToken('camp-1')).toBeNull();
    setPublishToken('camp-1', 'tok-abc');
    expect(getPublishToken('camp-1')).toBe('tok-abc');
    expect(getPublishToken('camp-2')).toBeNull();
  });

  it('clearPublishToken removes only that campaign', () => {
    setPublishToken('camp-1', 'tok-abc');
    setPublishToken('camp-2', 'tok-xyz');
    clearPublishToken('camp-1');
    expect(getPublishToken('camp-1')).toBeNull();
    expect(getPublishToken('camp-2')).toBe('tok-xyz');
  });
});
