import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, MapBuilderStore, ShapeChild } from '@/store/types';
import { pickMaterial, shownMaterial } from './materialPick';

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>()),
  isBandSet: (id: string | undefined) => !!id?.startsWith('GG_Cave'),
}));

const st = () => useStore.getState() as MapBuilderStore;
const layer = () => st().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const piece = (id: string) => layer().children.find((c) => c.id === id) as ShapeChild;

function shape(id: string, over: Partial<ShapeChild>): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff', ...over,
  };
}

describe('the Material column with a brush cave picked', () => {
  beforeEach(() => {
    undoManager.clear();
    st().resetToDefault();
    const id = layer().id;
    st().addChild(id, shape('cave', { edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } }));
    st().addChild(id, shape('plain', {}));
    useStore.setState((s) => {
      s.tools.settings.material.material = 'GG_Cave_Moss';
    });
  });

  it("shows the picked cave's rock as the picked tile, else what the brush holds", () => {
    expect(shownMaterial(st(), 'material')).toBe('GG_Cave_Moss');
    useStore.setState((s) => {
      s.selection.selectedIds = ['cave'];
    });
    expect(shownMaterial(st(), 'material')).toBe('GG_Cave_Ink');
  });

  it("changes the picked cave's rock at a click, in one undo step, and the brush with it", () => {
    useStore.setState((s) => {
      s.selection.selectedIds = ['cave', 'plain'];
    });
    pickMaterial('material', 'GG_Cave_Rubble');
    expect(piece('cave').edgeMaterial).toBe('GG_Cave_Rubble');
    expect(piece('plain').edgeMaterial).toBeUndefined();
    expect(st().tools.settings.material.material).toBe('GG_Cave_Rubble');
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(piece('cave').edgeMaterial).toBe('GG_Cave_Ink');
    // A plain floor texture is for the next stroke only: it is no rock.
    pickMaterial('material', 'p:moss');
    expect(piece('cave').edgeMaterial).toBe('GG_Cave_Ink');
  });
});
