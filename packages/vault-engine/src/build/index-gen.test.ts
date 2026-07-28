// packages/engine/src/build/index-gen.test.ts
import { describe, it, expect } from 'vitest';
import { generateIndex, type IndexInput } from './index-gen.js';

describe('generateIndex', () => {
  const INPUT: IndexInput = {
    packs: [
      {
        name: 'dungeon-classic',
        version: '1.2.0',
        bundleSize: 2847192,
        entryCount: 342,
        themes: ['dungeon', 'stone'],
        previewFile: 'dungeon-classic/preview-f7g8h9.webp',
        manifestFile: 'dungeon-classic/pack-d7e8f9.json',
      },
    ],
    totalEntries: 342,
    chunkCount: 1,
  };

  it('produces index with version 1', () => {
    const index = generateIndex(INPUT);
    expect(index.version).toBe(1);
  });

  it('includes pack summaries keyed by name', () => {
    const index = generateIndex(INPUT);
    expect(index.packs).toHaveProperty('dungeon-classic');
    expect(index.packs['dungeon-classic']!.version).toBe('1.2.0');
  });

  it('includes catalog summary', () => {
    const index = generateIndex(INPUT);
    expect(index.catalog.totalEntries).toBe(342);
    expect(index.catalog.chunkCount).toBe(1);
  });

  it('has valid ISO datetime in lastUpdated', () => {
    const index = generateIndex(INPUT);
    expect(() => new Date(index.catalog.lastUpdated)).not.toThrow();
  });
});
