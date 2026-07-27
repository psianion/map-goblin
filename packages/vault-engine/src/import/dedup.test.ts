import { describe, it, expect } from 'vitest';
import { findDuplicates, type HashEntry } from './dedup.js';

describe('findDuplicates', () => {
  const entries: HashEntry[] = [
    { id: 'a', hash: '0000000000000000' },
    { id: 'b', hash: '0000000000000001' }, // 1 bit from a → duplicate
    { id: 'c', hash: '00000000000000ff' }, // 8 bits from a → similar
    { id: 'd', hash: 'ffffffffffffffff' }, // 64 bits from a → different
  ];

  it('finds duplicates within threshold 5', () => {
    const dupes = findDuplicates(entries, { duplicateThreshold: 5 });
    const aDupes = dupes.find((d) => d.id === 'a');
    expect(aDupes?.duplicates).toContain('b');
    expect(aDupes?.duplicates).not.toContain('d');
  });

  it('finds similar within threshold 8', () => {
    const dupes = findDuplicates(entries, { similarThreshold: 8 });
    const aSimilar = dupes.find((d) => d.id === 'a');
    expect(aSimilar?.similar).toContain('c');
  });

  it('returns empty for unique entries', () => {
    const unique: HashEntry[] = [
      { id: 'x', hash: '0000000000000000' },
      { id: 'y', hash: 'ffffffffffffffff' },
    ];
    const dupes = findDuplicates(unique);
    expect(dupes.every((d) => d.duplicates.length === 0)).toBe(true);
  });
});
