import { describe, it, expect } from 'vitest';
import { importedMapToDocument } from './toDocument';
import type { ImportedMap } from './types';
import type { DungeonLayer } from '../../store/types';
import type { AssetChild, DoorChild, LightChild } from '../types';

const MAP: ImportedMap = {
  name: 'Cellar',
  size: { width: 10, height: 8 },
  image: { dataUrl: 'data:image/png;base64,AAAA', width: 1400, height: 1120, pxPerCell: 140 },
  walls: [{ points: [[0, 0], [10, 0]], wallType: 'ethereal', direction: 'left' }],
  doors: [
    { a: [4, 0], b: [6, 0], state: 'locked', isSecret: true, archway: false },
    { a: [0, 3], b: [0, 4], state: 'closed', isSecret: false, archway: true },
  ],
  lights: [{ x: 5, y: 4, radius: 8, featherRadius: 4, color: '#eaefca', intensity: 0.9, hidden: true }],
  ambientLight: '#ffffff',
  warnings: [],
};

describe('importedMapToDocument', () => {
  const doc = importedMapToDocument(MAP);
  const layers = doc.layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  const [base, walls] = layers;

  it('is a current-version document pinned to the imported size', () => {
    expect(doc.version).toBe('3.1');
    expect(doc.mapSettings).toMatchObject({ name: 'Cellar', fixedSize: { width: 10, height: 8 }, ambientLight: '#ffffff' });
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Battlemap', 'Walls']);
  });

  it('locks the image layer with the picture filling the map from the corner', () => {
    expect(base.locked).toBe(true);
    const image = base.children[0] as AssetChild;
    expect(image).toMatchObject({ objectType: 'image', width: 10, height: 8, position: { x: 5, y: 4 } });
    expect(doc.customImages[image.assetId]).toBe(MAP.image!.dataUrl);
    expect(base.standaloneWalls).toEqual([]);
  });

  it('puts walls, one host segment per door, and lights on the unlocked layer', () => {
    expect(walls.locked).toBe(false);
    expect(walls.standaloneWalls).toHaveLength(3);
    expect(walls.standaloneWalls[0]).toMatchObject({ points: [[0, 0], [10, 0]], wallType: 'ethereal', direction: 'left' });

    const doors = walls.children.filter((c): c is DoorChild => c.childType === 'door');
    expect(doors).toHaveLength(2);
    expect(doors[0]).toMatchObject({
      wallId: walls.standaloneWalls[1].id,
      position: [5, 0],
      angle: 0,
      width: 2,
      style: 'single',
      state: 'locked',
      isSecret: true,
    });
    expect(doors[1]).toMatchObject({ wallId: walls.standaloneWalls[2].id, style: 'archway', state: 'open', width: 1 });
    expect(doors[1].angle).toBeCloseTo(Math.PI / 2);

    const light = walls.children.find((c): c is LightChild => c.childType === 'light')!;
    expect(light).toMatchObject({ position: { x: 5, y: 4 }, radius: 8, featherRadius: 4, color: '#eaefca', visible: false });
  });

  it('leaves the base layer unlocked and empty when there is no image', () => {
    const bare = importedMapToDocument({ ...MAP, image: null });
    const b = bare.layers[1] as DungeonLayer;
    expect(b.locked).toBe(false);
    expect(b.children).toEqual([]);
    expect(bare.customImages).toEqual({});
  });
});
