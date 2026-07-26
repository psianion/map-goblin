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

  it('rejects entry with invalid type', () => {
    const bad = {
      ...VALID_MANIFEST,
      entries: { bad: { ...Object.values(VALID_MANIFEST.entries)[0], type: 'invalid' } },
    };
    expect(PackManifestSchema.safeParse(bad).success).toBe(false);
  });
});
