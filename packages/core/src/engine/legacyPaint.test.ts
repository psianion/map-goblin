// An older map's brush paint converted where the layer is drawn, and written back to the store.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { MaterialPatch } from '../shared/materialPatch';
import { useStore } from '../store/store';
import { healLegacyPaint } from './legacyPaint';

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

const plain: MaterialPatch = { id: 'p', material: 'pack:wild_grass_8x8_floor_A', rings: [[[0, 0], [6, 0], [6, 4], [0, 4]]], smooth: false, border: false };
const cave: MaterialPatch = { id: 'c', material: 'GG_Cave_Ink', rings: [[[10, 0], [14, 0], [14, 4], [10, 4]]], smooth: false, border: true };

function setPatches(materials: MaterialPatch[]): void {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon');
    if (l && l.type === 'dungeon') l.materials = materials;
  });
}

describe('healLegacyPaint', () => {
  it('converts a plain patch to a ground piece and writes the layer back', () => {
    setPatches([plain]);
    const healed = healLegacyPaint(dungeon());
    const shapes = (layer: DungeonLayer) => layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
    expect(shapes(healed).length).toBe(1);
    expect(shapes(healed)[0]).toMatchObject({ id: 'p', ground: true, textureId: 'pack:wild_grass_8x8_floor_A' });
    expect(healed.materials).toBeUndefined();
    expect(shapes(dungeon()).length).toBe(1);
    expect(shapes(dungeon())[0]).toMatchObject({ id: 'p', ground: true, textureId: 'pack:wild_grass_8x8_floor_A' });
    expect(dungeon().materials).toBeUndefined();
    // Nothing left to convert: the layer comes back as it was given.
    const again = dungeon();
    expect(healLegacyPaint(again)).toBe(again);
  });

  it('holds a layer’s patches together while the asset boot has not named a band set’s fill', () => {
    setPatches([plain, cave]);
    const layer = dungeon();
    expect(healLegacyPaint(layer)).toBe(layer);
    expect(dungeon().materials?.map((p) => p.id)).toEqual(['p', 'c']);
  });
});
