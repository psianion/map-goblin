import { describe, it, expect } from 'vitest';
import { TaxonomySchema } from './taxonomy.js';

const VALID_TAXONOMY = {
  types: ['floor', 'wall', 'pattern', 'edge', 'object', 'scatter', 'path', 'portal', 'light-mask'],
  themes: ['dungeon', 'tavern', 'forest'],
  materials: {
    stone: ['cobble', 'brick', 'slate'],
    wood: ['oak', 'aged'],
  },
  pieceTypes: {
    wall: ['straight', 'corner-90', 'ending'],
    floor: ['base'],
    path: ['straight', 'curve'],
  },
};

describe('TaxonomySchema', () => {
  it('accepts valid taxonomy', () => {
    const result = TaxonomySchema.safeParse(VALID_TAXONOMY);
    expect(result.success).toBe(true);
  });

  it('rejects missing types array', () => {
    const { types: _, ...rest } = VALID_TAXONOMY;
    const result = TaxonomySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty types array', () => {
    const result = TaxonomySchema.safeParse({ ...VALID_TAXONOMY, types: [] });
    expect(result.success).toBe(false);
  });

  it('rejects unknown asset type strings', () => {
    const result = TaxonomySchema.safeParse({
      ...VALID_TAXONOMY,
      types: ['floor', 'invalid-type'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty materials object', () => {
    const result = TaxonomySchema.safeParse({ ...VALID_TAXONOMY, materials: {} });
    expect(result.success).toBe(false);
  });
});
