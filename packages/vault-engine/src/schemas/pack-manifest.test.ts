import { describe, it, expect } from 'vitest';
import { PackManifestSchema } from './pack-manifest.js';

const VALID_MANIFEST = {
  name: 'dungeon-classic',
  version: '1.2.0',
  description: 'Foundation stone dungeon pack',
  theme: ['dungeon', 'stone'],
  entries: {
    'stone-cobble_1x1_floor_A': {
      type: 'floor',
      material: 'stone-cobble',
      gridSize: '1x1',
      pieceType: 'floor',
      variant: 'A',
      atlas: 'atlas-floors-a3b2c1.webp',
      frame: { x: 0, y: 0, w: 200, h: 200 },
      tags: ['stone', 'cobble'],
    },
  },
  atlases: {
    'atlas-floors-a3b2c1.webp': { checksum: 'sha256:abc123', size: 1048576 },
    'atlas-floors-a3b2c1.json': { checksum: 'sha256:def456', size: 4096 },
  },
  files: {
    'iron-chandelier_2x2_light_1.webp': { checksum: 'sha256:mno345', size: 24576 },
  },
  bundleSize: 2847192,
};

describe('PackManifestSchema', () => {
  it('accepts valid manifest', () => {
    expect(PackManifestSchema.safeParse(VALID_MANIFEST).success).toBe(true);
  });

  it('rejects invalid semver', () => {
    expect(PackManifestSchema.safeParse({ ...VALID_MANIFEST, version: 'bad' }).success).toBe(false);
  });

  it('rejects missing entries', () => {
    const { entries: _, ...rest } = VALID_MANIFEST;
    expect(PackManifestSchema.safeParse(rest).success).toBe(false);
  });

  it('keeps the family key on an entry', () => {
    const withFamily = {
      ...VALID_MANIFEST,
      entries: { crate_1_1x1_object_A: { ...Object.values(VALID_MANIFEST.entries)[0], type: 'object', family: 'crate' } },
    };
    const parsed = PackManifestSchema.parse(withFamily);
    expect(parsed.entries['crate_1_1x1_object_A']!.family).toBe('crate');
  });

  it('rejects entry with invalid type', () => {
    const bad = {
      ...VALID_MANIFEST,
      entries: { bad: { ...Object.values(VALID_MANIFEST.entries)[0], type: 'invalid' } },
    };
    expect(PackManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('kit entries', () => {
  const kitEntry = {
    type: 'kit',
    material: 'road-dirt',
    gridSize: '1x1',
    pieceType: 'kit',
    variant: 'A',
    set: 'road-dirt',
    tags: ['path', 'kit'],
    kit: {
      kind: 'surface',
      fill: 'road-dirt-fill',
      edge: [{ key: 'dirt-pebbles_1x1_object_A', weight: 2, spacing: 0.8, jitter: 0.6 }],
    },
  };

  it('accepts a kit entry and keeps its manifest', () => {
    const parsed = PackManifestSchema.parse({ ...VALID_MANIFEST, entries: { 'road-dirt-kit': kitEntry } });
    expect(parsed.entries['road-dirt-kit']!.kit).toEqual(kitEntry.kit);
  });

  it('rejects a kit of an unknown kind or a band with no straight', () => {
    const bad = (kit: unknown) =>
      PackManifestSchema.safeParse({ ...VALID_MANIFEST, entries: { k: { ...kitEntry, kit } } }).success;
    expect(bad({ kind: 'ribbon' })).toBe(false);
    expect(bad({ kind: 'band', band: { straight: [], bendDrawn: true } })).toBe(false);
    expect(bad({ kind: 'planks', cross: [{ key: 'plank', weight: 1 }], railPost: 'post', rope: { color: '#6b4a2b', width: 0.06 } })).toBe(true);
  });

  it('keeps a kit’s unit scale, per unit and per band, and rejects a scale of zero', () => {
    const scaled = { ...kitEntry.kit, scale: 0.5, edge: [{ ...kitEntry.kit.edge[0], scale: 0.6 }], band: { straight: ['bank'], bendDrawn: true, scale: 1 } };
    const parsed = PackManifestSchema.parse({ ...VALID_MANIFEST, entries: { k: { ...kitEntry, kit: scaled } } });
    expect(parsed.entries.k!.kit).toEqual(scaled);
    const bad = (kit: unknown) => PackManifestSchema.safeParse({ ...VALID_MANIFEST, entries: { k: { ...kitEntry, kit } } }).success;
    expect(bad({ ...kitEntry.kit, scale: 0 })).toBe(false);
    expect(bad({ ...kitEntry.kit, edge: [{ ...kitEntry.kit.edge[0], scale: -1 }] })).toBe(false);
  });

  it('keeps a kit’s attached objects, a key into another pack too, and rejects a side that is not -1, 0 or 1', () => {
    const objects = [
      { key: 'gg-demo:tree_small_1_3x3_object_A', weight: 1, spacing: 6, jitter: 3.14, side: 1 },
      { key: 'water-lily-pads_1x1_object_A', weight: 2, spacing: 3, jitter: 3.14, side: -1 },
    ];
    const parsed = PackManifestSchema.parse({ ...VALID_MANIFEST, entries: { k: { ...kitEntry, kit: { ...kitEntry.kit, objects } } } });
    expect(parsed.entries.k!.kit?.objects).toEqual(objects);
    const bad = PackManifestSchema.safeParse({
      ...VALID_MANIFEST,
      entries: { k: { ...kitEntry, kit: { ...kitEntry.kit, objects: [{ ...objects[0], side: 2 }] } } },
    });
    expect(bad.success).toBe(false);
  });

  it('keeps a water kit’s fall piece, and rejects an empty one', () => {
    const water = { kind: 'surface', fill: 'water-fill', band: { straight: ['water-bank'], bendDrawn: true }, fall: 'water-fall' };
    const parsed = PackManifestSchema.parse({ ...VALID_MANIFEST, entries: { 'water-kit': { ...kitEntry, kit: water } } });
    expect(parsed.entries['water-kit']!.kit?.fall).toBe('water-fall');
    expect(PackManifestSchema.safeParse({ ...VALID_MANIFEST, entries: { k: { ...kitEntry, kit: { ...water, fall: '' } } } }).success).toBe(false);
  });
});
