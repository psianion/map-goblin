import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { TerrainAppearanceCommand } from '../commands';
import { undoManager } from '../undoManager';
import { DEFAULT_TERRAIN_PALETTE, MAX_FIXED_CELLS, normalizeFixedSize } from './mapSettings';

describe('setTerrainData (appearance fields)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('creates mapSettings.terrain with the default palette when absent', () => {
    expect(useStore.getState().mapSettings.terrain).toBeUndefined();

    useStore.getState().setTerrainData({ visible: false });

    const terrain = useStore.getState().mapSettings.terrain;
    expect(terrain).toBeDefined();
    expect(terrain?.visible).toBe(false);
    expect(terrain?.palette).toEqual(DEFAULT_TERRAIN_PALETTE);
    expect(terrain?.bounds).toBeNull();
  });

  it('patches an existing terrain record without touching untouched fields', () => {
    useStore.getState().setTerrainData({ bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } });
    useStore.getState().setTerrainData({ opacity: 0.5 });

    const terrain = useStore.getState().mapSettings.terrain;
    expect(terrain?.opacity).toBe(0.5);
    expect(terrain?.bounds).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 5 });
  });

  it('defaults: absent visible reads as true, absent opacity reads as 1', () => {
    useStore.getState().setTerrainData({ opacity: 0.3 }); // visible untouched
    const terrain = useStore.getState().mapSettings.terrain!;
    expect(terrain.visible).toBeUndefined();
    expect(terrain.visible ?? true).toBe(true);
    expect(terrain.opacity ?? 1).toBe(0.3);
  });
});

describe('TerrainAppearanceCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('undo restores the prior appearance when terrain already existed', () => {
    useStore.getState().setTerrainData({ bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } });

    undoManager.execute(new TerrainAppearanceCommand({ visible: true }, { visible: false }));
    expect(useStore.getState().mapSettings.terrain?.visible).toBe(false);

    undoManager.undo();
    expect(useStore.getState().mapSettings.terrain?.visible).toBe(true);
  });

  it('is exactly one undo entry per commit', () => {
    useStore.getState().setTerrainData({ bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } });
    undoManager.execute(new TerrainAppearanceCommand({ opacity: 1 }, { opacity: 0.6 }));
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();
    expect(undoManager.canUndo()).toBe(false);
    expect(useStore.getState().mapSettings.terrain?.opacity).toBe(1);
  });

  // F6 / LOW-7: on a never-painted map, `mapSettings.terrain` doesn't exist
  // yet — the command creates it on execute, so undo has to drop the whole
  // record rather than patch it back to `before`, or a plain appearance
  // toggle left a stray terrain record on a map nobody ever painted.
  it('undo restores absence — never leaves a stray record on a never-painted map', () => {
    expect(useStore.getState().mapSettings.terrain).toBeUndefined();

    undoManager.execute(new TerrainAppearanceCommand({ visible: true }, { visible: false }));
    expect(useStore.getState().mapSettings.terrain?.visible).toBe(false);

    undoManager.undo();
    expect(useStore.getState().mapSettings.terrain).toBeUndefined();
  });
});

// fixedSize drives fog geometry and export sizing on both client and server, so the setter
// is the trust boundary: a bad number has to be refused, not persisted.
describe('setFixedSize', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('stores a whole-cell size', () => {
    useStore.getState().setFixedSize({ width: 30, height: 20 });
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 30, height: 20 });
  });

  it('clears back to a measured frame', () => {
    useStore.getState().setFixedSize({ width: 30, height: 20 });
    useStore.getState().setFixedSize(null);
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
  });

  it.each([
    ['zero', { width: 0, height: 10 }],
    ['negative', { width: -4, height: 10 }],
    ['fractional', { width: 10.5, height: 10 }],
    ['NaN', { width: Number.NaN, height: 10 }],
    ['Infinity', { width: Number.POSITIVE_INFINITY, height: 10 }],
    ['past the bound', { width: MAX_FIXED_CELLS + 1, height: 10 }],
  ])('refuses %s rather than persisting it', (_label, size) => {
    useStore.getState().setFixedSize(size);
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
  });

  it('normalizeFixedSize agrees with the setter', () => {
    expect(normalizeFixedSize({ width: MAX_FIXED_CELLS, height: 1 })).toEqual({
      width: MAX_FIXED_CELLS,
      height: 1,
    });
    expect(normalizeFixedSize(undefined)).toBeNull();
  });
});
