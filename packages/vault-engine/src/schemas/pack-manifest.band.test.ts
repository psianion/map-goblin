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

  it('keeps a band’s rock width, and rejects one that is not a positive number', () => {
    const band = { joints: [[1, 0.36], [-1, 0.36]], turnDeg: 0, rockWidth: 0.86 };
    expect(PackManifestSchema.parse(manifest(band)).entries.run_2x4_object_A?.band).toEqual(band);
    const width = (w: unknown) => PackManifestSchema.safeParse(manifest({ joints: [[1, 0], [-1, 0]], turnDeg: 0, rockWidth: w })).success;
    expect(width(0)).toBe(false);
    expect(width(-1)).toBe(false);
    expect(width('wide')).toBe(false);
  });

  it('keeps a band’s wall shadow, and rejects a reach that is not positive or a strength past 0 to 1', () => {
    const band = { joints: [[1, 0.36], [-1, 0.36]], turnDeg: 0, shadowReach: 0.35, shadowStrength: 0.62, shadowBaked: true };
    expect(PackManifestSchema.parse(manifest(band)).entries.run_2x4_object_A?.band).toEqual(band);
    const shadow = (extra: Record<string, unknown>) => PackManifestSchema.safeParse(manifest({ joints: [[1, 0], [-1, 0]], turnDeg: 0, ...extra })).success;
    expect(shadow({ shadowReach: 0 })).toBe(false);
    expect(shadow({ shadowStrength: 1.2 })).toBe(false);
    expect(shadow({ shadowStrength: -0.1 })).toBe(false);
    expect(shadow({ shadowBaked: 'yes' })).toBe(false);
  });

  it('keeps the middle of a band’s solid rock, and rejects a malformed one', () => {
    const band = { joints: [[1, 0.36], [-1, 0.36]], turnDeg: 0, middle: [[1, -0.1], [0, -0.12], [-1, -0.09]] };
    expect(PackManifestSchema.parse(manifest(band)).entries.run_2x4_object_A?.band).toEqual(band);
    const middle = (m: unknown) => PackManifestSchema.safeParse(manifest({ joints: [[1, 0], [-1, 0]], turnDeg: 0, middle: m })).success;
    expect(middle([[0, 1]])).toBe(false);
    expect(middle([[0, 1], [0, 'a']])).toBe(false);
    expect(middle([[0, 1], [0, Infinity]])).toBe(false);
  });
});
