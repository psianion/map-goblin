// src/io/autosave.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AUTOSAVE_DB_NAME,
  AUTOSAVE_STORE_NAME,
  AUTOSAVE_KEY,
  DIRTY_FLAG_KEY,
  setDirtyFlag,
  clearDirtyFlag,
  isDirtyFlagSet,
  saveToIndexedDB,
  loadFromIndexedDB,
} from './autosave.ts';
import type { SerializedMapData } from '@/store/types';

const SAMPLE_DATA: SerializedMapData = {
  version: '1.1',
  mapSettings: {
    name: 'Autosave Test',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#000000',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  layers: [],
  lights: [],
  placedObjects: [],
  customImages: {},
};

describe('autosave constants', () => {
  it('exports correct key constants', () => {
    expect(AUTOSAVE_DB_NAME).toBe('mapbuilder');
    expect(AUTOSAVE_STORE_NAME).toBe('saves');
    expect(AUTOSAVE_KEY).toBe('mapbuilder-autosave');
    expect(DIRTY_FLAG_KEY).toBe('mapbuilder-dirty');
  });
});

describe('dirty flag (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('isDirtyFlagSet returns false when flag is absent', () => {
    expect(isDirtyFlagSet()).toBe(false);
  });

  it('setDirtyFlag sets the flag', () => {
    setDirtyFlag();
    expect(isDirtyFlagSet()).toBe(true);
  });

  it('clearDirtyFlag clears the flag', () => {
    setDirtyFlag();
    clearDirtyFlag();
    expect(isDirtyFlagSet()).toBe(false);
  });
});

describe('IndexedDB autosave', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(AUTOSAVE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('loadFromIndexedDB returns null when no data exists', async () => {
    const result = await loadFromIndexedDB();
    expect(result).toBeNull();
  });

  it('saveToIndexedDB persists data and loadFromIndexedDB retrieves it', async () => {
    await saveToIndexedDB(SAMPLE_DATA);
    const result = await loadFromIndexedDB();
    expect(result).not.toBeNull();
    expect(result?.data.mapSettings.name).toBe('Autosave Test');
    expect(typeof result?.savedAt).toBe('number');
  });

  it('saveToIndexedDB overwrites previous save', async () => {
    await saveToIndexedDB(SAMPLE_DATA);
    const updated: SerializedMapData = {
      ...SAMPLE_DATA,
      mapSettings: { ...SAMPLE_DATA.mapSettings, name: 'Updated Map' },
    };
    await saveToIndexedDB(updated);
    const result = await loadFromIndexedDB();
    expect(result?.data.mapSettings.name).toBe('Updated Map');
  });
});
