import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalogDB } from './db.js';
import type { AssetMetadata } from '../types.js';

function makeMeta(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: 'stone_1x1_floor_A',
    sourceFile: 'floors/stone-A.png',
    type: 'floor',
    theme: 'dungeon',
    material: 'stone-cobble',
    gridSize: '1x1',
    pieceType: 'base',
    variant: 'A',
    tint: '#7a7a6e',
    tool: ['floor-fill'],
    tileable: true,
    transparency: false,
    contentBounds: { x: 0, y: 0, w: 200, h: 200 },
    perceptualHash: 'abcdef0123456789',
    width: 200,
    height: 200,
    ...overrides,
  };
}

describe('CatalogDB', () => {
  let db: CatalogDB;

  beforeEach(() => {
    db = new CatalogDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves an asset', () => {
    const meta = makeMeta();
    db.upsert(meta);
    const result = db.getById(meta.id);
    expect(result).not.toBeNull();
    expect(result?.material).toBe('stone-cobble');
  });

  it('upserts (updates on conflict)', () => {
    db.upsert(makeMeta({ tint: '#111111' }));
    db.upsert(makeMeta({ tint: '#222222' }));
    const result = db.getById('stone_1x1_floor_A');
    expect(result?.tint).toBe('#222222');
  });

  it('lists all assets', () => {
    db.upsert(makeMeta({ id: 'a' }));
    db.upsert(makeMeta({ id: 'b' }));
    expect(db.getAll()).toHaveLength(2);
  });

  it('deletes an asset', () => {
    db.upsert(makeMeta());
    db.delete('stone_1x1_floor_A');
    expect(db.getById('stone_1x1_floor_A')).toBeNull();
  });

  it('getById returns null for non-existent id', () => {
    expect(db.getById('does-not-exist')).toBeNull();
  });

  it('getAll returns empty array when no assets exist', () => {
    expect(db.getAll()).toEqual([]);
  });

  it('round-trips tool array through JSON serialization', () => {
    const meta = makeMeta({ tool: ['floor-fill', 'stamp'] });
    db.upsert(meta);
    const result = db.getById(meta.id);
    expect(result?.tool).toEqual(['floor-fill', 'stamp']);
  });

  it('round-trips contentBounds through JSON serialization', () => {
    const bounds = { x: 10, y: 20, w: 150, h: 180 };
    db.upsert(makeMeta({ contentBounds: bounds }));
    const result = db.getById('stone_1x1_floor_A');
    expect(result?.contentBounds).toEqual(bounds);
  });

  it('returns fallback for malformed JSON in tool column', () => {
    db.upsert(makeMeta());
    const raw = db['db'];
    raw.prepare("UPDATE assets SET tool = 'not-valid-json{' WHERE id = ?").run(
      'stone_1x1_floor_A',
    );
    const result = db.getById('stone_1x1_floor_A');
    expect(result).not.toBeNull();
    expect(result!.tool).toEqual([]);
  });

  it('returns fallback for malformed JSON in content_bounds column', () => {
    db.upsert(makeMeta());
    const raw = db['db'];
    raw
      .prepare(
        "UPDATE assets SET content_bounds = '{{broken' WHERE id = ?",
      )
      .run('stone_1x1_floor_A');
    const result = db.getById('stone_1x1_floor_A');
    expect(result).not.toBeNull();
    expect(result!.contentBounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('handles null-ish values in row without crashing unexpectedly', () => {
    db.upsert(makeMeta());
    const raw = db['db'];
    // Set theme to empty string (valid but edge case)
    raw
      .prepare("UPDATE assets SET theme = '' WHERE id = ?")
      .run('stone_1x1_floor_A');
    const result = db.getById('stone_1x1_floor_A');
    expect(result?.theme).toBe('');
  });

  it('byType returns matching rows', () => {
    db.upsert(makeMeta({ id: 'a', type: 'floor' }));
    db.upsert(makeMeta({ id: 'b', type: 'wall' }));
    const results = db.byType('floor');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('a');
  });

  it('upsertMany inserts every row in one transaction', () => {
    db.upsertMany([makeMeta({ id: 'm1' }), makeMeta({ id: 'm2' })]);
    expect(db.getById('m1')).not.toBeNull();
    expect(db.getById('m2')).not.toBeNull();
  });

  it('preserves boolean fields through round-trip', () => {
    db.upsert(makeMeta({ tileable: true, transparency: true }));
    const result = db.getById('stone_1x1_floor_A');
    expect(result?.tileable).toBe(true);
    expect(result?.transparency).toBe(true);

    db.upsert(makeMeta({ tileable: false, transparency: false }));
    const result2 = db.getById('stone_1x1_floor_A');
    expect(result2?.tileable).toBe(false);
    expect(result2?.transparency).toBe(false);
  });
});
