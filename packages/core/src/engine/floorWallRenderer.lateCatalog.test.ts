// A floor baked while the catalogue lists some packs but not yet the one its texture comes
// from paints flat, its texture judged retired. Once that pack is read, the floors must bake
// again, or the flat fill stays for good.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { useStore } from '../store/store';
import type { DungeonLayer, ShapeChild } from '../store/types';
import { shapeFloorFill } from './floorWallRenderer';

const dungeon = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const epoch = () => useStore.getState().floorTextureEpochs[dungeon().id] ?? 0;

const floorEntry = (material: string) => ({ type: 'floor', material, gridSize: '8x8', set: 'Test_Floors', tags: [] });

const piece: ShapeChild = {
  id: 'grass', name: 'Grass 1', childType: 'shape', visible: true, shapeType: 'polygon',
  contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
  textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  ground: true, textureId: 'pack-b:wild_grass_8x8_floor_A',
};

beforeEach(() => {
  resetAssetPackManager();
  useStore.getState().resetToDefault();
  useStore.setState({ floorTextureEpochs: {} });
});

afterEach(() => resetAssetPackManager());

describe('a floor baked before its pack is read', () => {
  it('bakes again once the pack lands in the catalogue', () => {
    seedPack('pack-a', { stone_8x8_floor_A: floorEntry('stone') } as never);
    const fill = shapeFloorFill(piece, dungeon().style);
    // Pack B is not read yet: the texture reads as retired and the piece paints flat.
    expect(fill.kind).toBe('solid');
    const before = epoch();
    seedPack('pack-b', { wild_grass_8x8_floor_A: floorEntry('wild_grass') } as never);
    const armed = fill.kind === 'solid' && fill.waitFor !== undefined;
    expect(armed || epoch() > before).toBe(true);
  });
});
