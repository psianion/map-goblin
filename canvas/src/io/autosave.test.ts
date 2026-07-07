// src/io/autosave.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/toast', () => ({
  notify: {
    subtle: vi.fn(),
    action: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

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
  startAutosave,
} from './autosave.ts';
import { notify } from '@/lib/toast';
import type { SerializedMapData } from '@/store/types';

const SAMPLE_DATA: SerializedMapData = {
  version: '2.0',
  mapSettings: {
    name: 'Autosave Test',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#000000',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  layers: [],
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

  it('loadFromIndexedDB discards stale v1.x autosaves and returns null', async () => {
    const staleData = {
      version: '1.4',
      mapSettings: { name: 'Old Map', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000' },
      grid: { visible: true, snapDivision: 2, style: 'clean' },
      layers: [],
      lights: [],
      placedObjects: [],
      customImages: {},
    };
    await saveToIndexedDB(staleData as unknown as SerializedMapData);
    const result = await loadFromIndexedDB();
    expect(result).toBeNull();
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

describe('startAutosave failure surfacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('surfaces a toast when the debounced autosave fails', async () => {
    let listener: () => void = () => {};
    const subscribe = (l: () => void) => {
      listener = l;
      return () => {};
    };
    const saveCurrentMap = vi.fn().mockRejectedValue(new Error('disk full'));

    const stop = startAutosave(saveCurrentMap, subscribe);
    listener(); // marks dirty + schedules the 30s debounced save
    await vi.advanceTimersByTimeAsync(30_000);

    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    expect(notify.action).toHaveBeenCalledWith(
      'Autosave failed — your changes may not be saved',
      expect.objectContaining({ label: 'Retry' }),
    );
    stop();
  });
});
