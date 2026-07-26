// packages/engine/src/build/manifest.test.ts
import { describe, it, expect } from 'vitest';
import { generateManifest, type ManifestInput } from './manifest.js';

describe('generateManifest', () => {
  const INPUT: ManifestInput = {
    name: 'test-pack',
    version: '1.0.0',
    description: 'A test pack',
    themes: ['dungeon'],
    entries: [
      {
        localId: 'stone_1x1_floor_A',
        type: 'floor',
        material: 'stone-cobble',
        gridSize: '1x1',
        pieceType: 'floor',
        variant: 'A',
        tags: ['stone'],
        atlasFile: 'atlas-floors-abc123.webp',
        frame: { x: 0, y: 0, w: 200, h: 200 },
      },
    ],
    atlasFiles: [
      { filename: 'atlas-floors-abc123.webp', data: Buffer.from('fake webp'), size: 9 },
      { filename: 'atlas-floors-abc123.json', data: Buffer.from('fake json'), size: 9 },
    ],
    individualFiles: [
      { filename: 'chandelier.webp', data: Buffer.from('fake object'), size: 11 },
    ],
  };

  it('produces valid manifest with name and version', () => {
    const manifest = generateManifest(INPUT);
    expect(manifest.name).toBe('test-pack');
    expect(manifest.version).toBe('1.0.0');
  });

  it('includes entries keyed by localId', () => {
    const manifest = generateManifest(INPUT);
    expect(manifest.entries).toHaveProperty('stone_1x1_floor_A');
    expect(manifest.entries['stone_1x1_floor_A']!.type).toBe('floor');
  });

  it('includes atlases with sha256 checksums', () => {
    const manifest = generateManifest(INPUT);
    const key = Object.keys(manifest.atlases)[0]!;
    expect(manifest.atlases[key]!.checksum).toMatch(/^sha256:/);
    expect(manifest.atlases[key]!.size).toBeGreaterThan(0);
  });

  it('includes individual files with checksums', () => {
    const manifest = generateManifest(INPUT);
    expect(manifest.files).toHaveProperty('chandelier.webp');
    expect(manifest.files['chandelier.webp']!.checksum).toMatch(/^sha256:/);
  });

  it('computes total bundleSize', () => {
    const manifest = generateManifest(INPUT);
    expect(manifest.bundleSize).toBe(9 + 9 + 11); // sum of all file sizes
  });
});
