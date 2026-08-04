import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { TerrainAppearanceCommand } from '../commands';
import { undoManager } from '../undoManager';
import { DEFAULT_TERRAIN_PALETTE } from './mapSettings';

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
