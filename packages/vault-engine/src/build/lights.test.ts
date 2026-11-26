// packages/engine/src/build/lights.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addLights, LIGHT_PROPS } from './lights.js';
import { PackManifestSchema, type PackManifest } from '../schemas/pack-manifest.js';

const GG_DEMO = fileURLToPath(new URL('../../../../canvas/public/packs/index.json', import.meta.url));

function ggDemo(): PackManifest {
  const index = JSON.parse(readFileSync(GG_DEMO, 'utf-8')) as { packs: Record<string, { manifest: string }> };
  const path = fileURLToPath(new URL(`../../../../canvas/public/packs/${index.packs['gg-demo']!.manifest}`, import.meta.url));
  return PackManifestSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

function entry(material: string, gridSize = '1x1') {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', tags: ['light'] };
}

const SMALL = {
  name: 'test-pack',
  version: '0.1.0',
  description: '',
  theme: ['fantasy'],
  entries: {
    light_candle_large_lit_1x1_object_A: entry('light_candle_large_lit'),
    light_candle_large_unlit_1x1_object_A: entry('light_candle_large_unlit'),
    light_brazier_2_a_1x1_object_A: entry('light_brazier_2_a'),
    light_brazier_2_b_1x1_object_A: entry('light_brazier_2_b'),
    light_brazier_2_c_1x1_object_A: entry('light_brazier_2_c'),
    campfire_1x1_object_A: entry('campfire'),
    campfire_cooking_spit_2x1_object_A: entry('campfire_cooking_spit', '2x1'),
  },
  atlases: {},
  files: {},
  bundleSize: 0,
} as unknown as PackManifest;

describe('addLights', () => {
  const rows = LIGHT_PROPS.filter((r) =>
    [r.on, r.fixed].some((m) => m === 'light_candle_large_lit' || m === 'light_brazier_2_c' || m === 'campfire'),
  );

  it('writes the preset and both pictures on a lit and unlit pair', () => {
    const out = addLights(SMALL, rows).entries;
    const states = { on: 'light_candle_large_lit_1x1_object_A', off: 'light_candle_large_unlit_1x1_object_A' };
    expect(out['light_candle_large_lit_1x1_object_A']!.light).toEqual({ preset: 'candle', states });
    expect(out['light_candle_large_unlit_1x1_object_A']!.light).toEqual({ preset: 'candle', states });
  });

  it('keeps the brazier number and writes all three states', () => {
    const out = addLights(SMALL, rows).entries;
    for (const s of ['a', 'b', 'c']) {
      expect(out[`light_brazier_2_${s}_1x1_object_A`]!.light).toEqual({
        preset: 'brazier',
        states: {
          off: 'light_brazier_2_a_1x1_object_A',
          embers: 'light_brazier_2_b_1x1_object_A',
          on: 'light_brazier_2_c_1x1_object_A',
        },
      });
    }
  });

  it('gives a fixed-picture prop a light with no states, and leaves unlisted light-tagged entries alone', () => {
    const out = addLights(SMALL, rows).entries;
    expect(out['campfire_1x1_object_A']!.light).toEqual({ preset: 'brazier' });
    expect(out['campfire_cooking_spit_2x1_object_A']).not.toHaveProperty('light');
    expect(SMALL.entries['campfire_1x1_object_A']).not.toHaveProperty('light');
  });

  it('throws on a table material the pack does not hold', () => {
    expect(() => addLights(SMALL, [{ preset: 'candle', fixed: 'no_such_thing' }])).toThrow(/no_such_thing/);
  });

  it('resolves every row of the table against the shipped gg-demo pack', () => {
    const out = PackManifestSchema.parse(addLights(ggDemo())).entries;
    const lit = Object.entries(out).filter(([, e]) => e.light);
    // 12 pairs (24 entries), 3 braziers (9), 9 fixed pictures.
    expect(lit.length).toBe(24 + 9 + 9);
    for (const [, e] of lit) {
      for (const key of Object.values(e.light!.states ?? {})) expect(out[key], key).toBeDefined();
    }
    const tagged = Object.entries(out).filter(([, e]) => e.tags.includes('light') && !e.light).map(([k]) => k);
    expect(tagged.sort()).toEqual([
      'campfire_cooking_spit_2x1_object_A',
      'campfire_hog_1x1_object_A',
      'campfire_pot_cooking_1x1_object_A',
      'campfire_ring_2x2_object_A',
      'campfire_wood_1x1_object_A',
    ]);
  });
});
