import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalogDB } from './db.js';
import { queryByType, queryByMaterial, queryByTheme } from './queries.js';
import type { AssetMetadata } from '../types.js';

function makeMeta(overrides: Partial<AssetMetadata>): AssetMetadata {
  return {
    id: 'test',
    sourceFile: 'test.png',
    type: 'floor',
    theme: 'dungeon',
    material: 'stone-cobble',
    gridSize: '1x1',
    pieceType: 'base',
    variant: 'A',
    tint: '#000000',
    tool: ['floor-fill'],
    tileable: false,
    transparency: false,
    contentBounds: { x: 0, y: 0, w: 200, h: 200 },
    perceptualHash: '0000000000000000',
    width: 200,
    height: 200,
    ...overrides,
  };
}

describe('catalog queries', () => {
  let db: CatalogDB;

  beforeEach(() => {
    db = new CatalogDB(':memory:');
    db.upsert(
      makeMeta({ id: 'f1', type: 'floor', material: 'stone-cobble', theme: 'dungeon' }),
    );
    db.upsert(
      makeMeta({ id: 'f2', type: 'floor', material: 'wood-oak', theme: 'tavern' }),
    );
    db.upsert(
      makeMeta({ id: 'w1', type: 'wall', material: 'stone-cobble', theme: 'dungeon' }),
    );
    db.upsert(
      makeMeta({ id: 'o1', type: 'object', material: 'metal-iron', theme: 'dungeon' }),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('queryByType returns only matching type', () => {
    const floors = queryByType(db, 'floor');
    expect(floors).toHaveLength(2);
    expect(floors.every((f) => f.type === 'floor')).toBe(true);
  });

  it('queryByMaterial matches prefix', () => {
    const stone = queryByMaterial(db, 'stone');
    expect(stone).toHaveLength(2);
  });

  it('queryByTheme returns matching theme', () => {
    const dungeon = queryByTheme(db, 'dungeon');
    expect(dungeon).toHaveLength(3);
  });
});
