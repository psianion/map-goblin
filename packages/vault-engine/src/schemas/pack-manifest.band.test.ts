import { describe, it, expect } from 'vitest';
import { PackManifestSchema } from './pack-manifest.js';

const manifest = (band: unknown) => ({
  name: 'band-kit',
  version: '1.0.0',
  description: 'A band kit that carries its own measurements',
  theme: ['cave'],
  entries: {
    run_2x4_object_A: {
      type: 'object',
      material: 'run',
      gridSize: '2x4',
      pieceType: 'object',
      variant: 'A',
      set: 'Test_Kit',
      tags: [],
      band,
    },
  },
  atlases: {},
  files: {},
  bundleSize: 0,
});

describe('PackManifestSchema: band measurements', () => {
  it('accepts an entry carrying its band joints, turn and end flag', () => {
    const band = { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, end: false };
    const parsed = PackManifestSchema.parse(manifest(band));
    expect(parsed.entries.run_2x4_object_A?.band).toEqual(band);
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0, -1]], turnDeg: 90 })).success).toBe(true);
  });

  it('rejects malformed joints', () => {
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1]], turnDeg: 0 })).success).toBe(false);
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0]], turnDeg: 0 })).success).toBe(false);
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0, 'a']], turnDeg: 0 })).success).toBe(false);
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0, -1]] })).success).toBe(false);
  });

  it('accepts a band with or without its spine, and rejects a malformed spine', () => {
    const band = { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.3, 0], [-0.065, -1.988]] };
    expect(PackManifestSchema.parse(manifest(band)).entries.run_2x4_object_A?.band).toEqual(band);
    expect(PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0, -1]], turnDeg: 0 })).success).toBe(true);
    const spine = (s: unknown) => PackManifestSchema.safeParse(manifest({ joints: [[0, 1], [0, -1]], turnDeg: 0, spine: s })).success;
    expect(spine([[0, 1]])).toBe(false);
    expect(spine([[0, 1], [0, 'a']])).toBe(false);
    expect(spine([[0, 1], [0, Infinity]])).toBe(false);
  });
});
