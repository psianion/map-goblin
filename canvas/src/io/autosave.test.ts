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
  isDocumentChange,
  isSettingsChange,
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AUTOSAVE_PROMPT_DELAY_MS,
  startAutosave,
} from './autosave.ts';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';
import type { DungeonLayer, WaterChild } from '@/store/types';

describe('isDocumentChange', () => {
  const base = () => {
    const layer = { id: 'l1', children: [], mergedFloor: null, rooms: [{ id: 'r', name: 'Hall', anchor: [1, 1] }] };
    return {
      mapSettings: { name: 'a' },
      grid: { visible: true },
      layers: [layer],
      assets: { customImages: {} },
      terrainSplats: { rev: 0 },
    };
  };

  it('is false when nothing moved', () => {
    const s = base();
    expect(isDocumentChange(s, s)).toBe(false);
  });

  it('is false when only the derived layer caches were rewritten', () => {
    const prev = base();
    // The refresh after load fills each room's face, centroid and doors: derived.
    const refreshed = { ...prev.layers[0].rooms[0], face: [[0, 0], [2, 0], [2, 2]], centroid: [1, 1], doors: [] };
    const next = {
      ...prev,
      layers: [{ ...prev.layers[0], mergedFloor: [[]], rooms: [refreshed] }],
    };
    expect(isDocumentChange(next, prev)).toBe(false);
  });

  it('counts a room edit as a prompt change: rooms are authored now', () => {
    const prev = base();
    const renamed = { ...prev.layers[0].rooms[0], name: 'Great Hall' };
    const next = { ...prev, layers: [{ ...prev.layers[0], rooms: [renamed] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('counts a levels change as a prompt change', () => {
    const prev = { ...base(), levels: [{ id: 'a', name: 'Ground' }] };
    const next = { ...prev, levels: [{ id: 'a', name: 'Cellar' }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('is true when a layer gains a child', () => {
    const prev = base();
    const next = { ...prev, layers: [{ ...prev.layers[0], children: [{ id: 'c' }] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
  });

  it('is true when the map settings, grid, or custom images change', () => {
    const prev = base();
    expect(isDocumentChange({ ...prev, mapSettings: { name: 'b' } }, prev)).toBe(true);
    expect(isDocumentChange({ ...prev, grid: { visible: false } }, prev)).toBe(true);
    expect(isDocumentChange({ ...prev, assets: { customImages: { a: 'b' } } }, prev)).toBe(true);
  });

  it('counts a snap division change as a change, and as a prompt one', () => {
    const prev = { ...base(), grid: { visible: true, snapDivision: 2 } };
    const next = { ...prev, grid: { ...prev.grid, snapDivision: 4 } };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('does not count snap on/off, which is a per-browser preference', () => {
    const prev = { ...base(), grid: { visible: true, snapDivision: 2, snapEnabled: true } };
    const next = { ...prev, grid: { ...prev.grid, snapEnabled: false } };
    expect(isDocumentChange(next, prev)).toBe(false);
  });

  it('is not prompt for a drawing change', () => {
    const prev = base();
    const next = { ...prev, layers: [{ ...prev.layers[0], children: [{ id: 'c' }] }] };
    expect(isSettingsChange(next, prev)).toBe(false);
  });

  // A lock or a hide is one click, like a layer's eye: it saves promptly.
  const withChildren = () => {
    const prev = base();
    const kids = [{ id: 'a', visible: true, position: { x: 0, y: 0 } }, { id: 'b', visible: true, position: { x: 1, y: 0 } }];
    return { ...prev, layers: [{ ...prev.layers[0], children: kids, standaloneWalls: [{ id: 'w', points: [[0, 0], [1, 0]] }] }] };
  };

  it('counts locking a child as a prompt change', () => {
    const prev = withChildren();
    const [a, b] = prev.layers[0].children;
    const next = { ...prev, layers: [{ ...prev.layers[0], children: [{ ...a, locked: true }, b] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('counts hiding a child as a prompt change', () => {
    const prev = withChildren();
    const [a, b] = prev.layers[0].children;
    const next = { ...prev, layers: [{ ...prev.layers[0], children: [a, { ...b, visible: false }] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('counts locking a wall as a prompt change', () => {
    const prev = withChildren();
    const next = { ...prev, layers: [{ ...prev.layers[0], standaloneWalls: [{ ...prev.layers[0].standaloneWalls[0], locked: true }] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('keeps a child move on the drawing debounce', () => {
    const prev = withChildren();
    const [a, b] = prev.layers[0].children;
    const next = { ...prev, layers: [{ ...prev.layers[0], children: [{ ...a, position: { x: 3, y: 0 } }, b] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(false);
    const both = { ...prev, layers: [{ ...prev.layers[0], children: [{ ...a, locked: true, position: { x: 3, y: 0 } }, b] }] };
    expect(isSettingsChange(both, prev)).toBe(false);
  });

  it("sees the store's own setSnapDivision as a prompt change", () => {
    const seen: [boolean, boolean][] = [];
    const stop = useStore.subscribe((s, prev) => {
      seen.push([isDocumentChange(s, prev), isSettingsChange(s, prev)]);
    });
    const was = useStore.getState().grid.snapDivision;
    useStore.getState().setSnapDivision(was === 4 ? 2 : 4);
    stop();
    expect(seen).toEqual([[true, true]]);
  });

  it('counts a layer opacity change as a change, and as a prompt one', () => {
    const prev = base();
    const next = { ...prev, layers: [{ ...prev.layers[0], opacity: 0.55 }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
  });

  it('is not prompt when a layer setting changes together with drawing', () => {
    const prev = base();
    const next = { ...prev, layers: [{ ...prev.layers[0], opacity: 0.55, children: [{ id: 'c' }] }] };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(false);
  });

  it("sees the store's own layer opacity edit as a prompt change that survives save and load", () => {
    const layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    const seen: [boolean, boolean][] = [];
    const stop = useStore.subscribe((s, prev) => {
      seen.push([isDocumentChange(s, prev), isSettingsChange(s, prev)]);
    });
    useStore.getState().updateLayer(layerId, { opacity: 0.55 });
    stop();
    expect(seen).toEqual([[true, true]]);

    const saved = JSON.parse(JSON.stringify(useStore.getState().getSerializableState()));
    useStore.getState().updateLayer(layerId, { opacity: 1 });
    useStore.getState().loadFromFile(saved);
    expect(useStore.getState().layers.find((l) => l.id === layerId)!.opacity).toBe(0.55);
  });

  it('is true when the terrain splat rev moves', () => {
    const prev = base();
    expect(isDocumentChange({ ...prev, terrainSplats: { rev: 1 } }, prev)).toBe(true);
  });

  it('is true when a layer is added or removed', () => {
    const prev = base();
    expect(isDocumentChange({ ...prev, layers: [...prev.layers, { id: 'l2' }] }, prev)).toBe(true);
  });

  it('counts a prep edit (a trigger, a note) as a prompt change', () => {
    const prev = { ...base(), prep: { version: 3, triggers: [], notes: [], rooms: [] } };
    const next = { ...prev, prep: { ...prev.prep, notes: [{ id: 'n' }] } };
    expect(isDocumentChange(next, prev)).toBe(true);
    expect(isSettingsChange(next, prev)).toBe(true);
    expect(isDocumentChange({ ...prev }, prev)).toBe(false);
  });
});

describe('startAutosave failure surfacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
    listener(); // marks dirty + schedules the debounced save
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    expect(notify.action).toHaveBeenCalledWith(
      'Autosave failed — your changes may not be saved',
      expect.objectContaining({ label: 'Retry' }),
    );
    stop();
  });
});

describe('startAutosave timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start() {
    let listener: (prompt?: boolean) => void = () => {};
    const saveCurrentMap = vi.fn().mockResolvedValue(undefined);
    const stop = startAutosave(saveCurrentMap, (l) => {
      listener = l;
      return () => {};
    });
    return { change: (prompt?: boolean) => listener(prompt), saveCurrentMap, stop };
  }

  it('saves a prompt change within seconds, not after the drawing debounce', async () => {
    const { change, saveCurrentMap, stop } = start();
    change(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_PROMPT_DELAY_MS);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not save a prompt change while a map switch is in flight', async () => {
    useStore.setState({ isMapSwitching: true });
    try {
      const { change, saveCurrentMap, stop } = start();
      change(true);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_PROMPT_DELAY_MS);
      expect(saveCurrentMap).not.toHaveBeenCalled();
      stop();
    } finally {
      useStore.setState({ isMapSwitching: false });
    }
  });

  it('does not let drawing that follows push a prompt save back out', async () => {
    const { change, saveCurrentMap, stop } = start();
    change(true);
    await vi.advanceTimersByTimeAsync(500);
    change(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_PROMPT_DELAY_MS - 500);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });

  it('waits 5 s after the last drawing change', async () => {
    const { change, saveCurrentMap, stop } = start();
    change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1_000);
    expect(saveCurrentMap).not.toHaveBeenCalled();
    // Another stroke: the wait starts again from it.
    change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(saveCurrentMap).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });

  it('strokes that keep coming save 15 s after the first unsaved one, then start a new wait', async () => {
    expect([AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS]).toEqual([5_000, 15_000]);
    const { change, saveCurrentMap, stop } = start();
    for (let t = 0; t < AUTOSAVE_MAX_WAIT_MS; t += 2_000) {
      change();
      await vi.advanceTimersByTimeAsync(2_000);
      if (t + 2_000 < AUTOSAVE_MAX_WAIT_MS) expect(saveCurrentMap).not.toHaveBeenCalled();
    }
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    // The next stroke is a fresh first change: 5 s on from it.
    change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saveCurrentMap).toHaveBeenCalledTimes(2);
    stop();
  });

  it('writes a pending save when the page goes away', async () => {
    const { change, saveCurrentMap, stop } = start();
    change();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    // Nothing left pending, so the timer does not save it a second time.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing on page hide with no change pending', () => {
    const { saveCurrentMap, stop } = start();
    window.dispatchEvent(new Event('pagehide'));
    expect(saveCurrentMap).not.toHaveBeenCalled();
    stop();
  });
});

describe('autosave of a hide, wired as App wires it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves after Ctrl+Shift+H hides a water body, within the prompt delay', async () => {
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    const water = {
      id: 'lake', name: 'Lake', childType: 'water', visible: true, waterType: 'lake', textureId: '', tint: '#ffffff',
      opacity: 1, bankTextureId: '', bankWidth: 0, contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    } as unknown as WaterChild;
    useStore.getState().addChild(layer.id, water);
    useStore.getState().setSelectedIds(['lake']);
    const saveCurrentMap = vi.fn().mockResolvedValue(undefined);
    const stop = startAutosave(saveCurrentMap, (listener) =>
      useStore.subscribe((s, prev) => {
        if (isDocumentChange(s, prev)) listener(isSettingsChange(s, prev));
      }),
    );
    handleShortcut('ctrl+shift+h');
    const after = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon')!;
    expect(after.children.find((c) => c.id === 'lake')!.visible).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_PROMPT_DELAY_MS);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });

  it('saves a trigger added through the prep slice within the prompt delay', async () => {
    const saveCurrentMap = vi.fn().mockResolvedValue(undefined);
    const stop = startAutosave(saveCurrentMap, (listener) =>
      useStore.subscribe((s, prev) => {
        if (isDocumentChange(s, prev)) listener(isSettingsChange(s, prev));
      }),
    );
    useStore.getState().upsertTrigger({
      id: 't', name: 'Wolves wake', when: { kind: 'enter-region', zoneId: 'z' }, actions: [], once: true, enabled: true,
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_PROMPT_DELAY_MS);
    expect(saveCurrentMap).toHaveBeenCalledTimes(1);
    stop();
  });
});
