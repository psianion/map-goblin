// src/store/presetRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { DUNGEON_STYLE_PRESETS, SCATTER_PRESETS } from './presetRegistry.ts';
import { TEXTURE_MANIFEST } from '../assets/textureManifest.ts';

const ALL_TEXTURE_IDS = new Set(TEXTURE_MANIFEST.map((e) => e.id));

describe('DUNGEON_STYLE_PRESETS', () => {
  it('has 5 presets with unique ids', () => {
    expect(DUNGEON_STYLE_PRESETS).toHaveLength(5);
    const ids = DUNGEON_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('all defaultTextureIds exist in TEXTURE_MANIFEST', () => {
    for (const preset of DUNGEON_STYLE_PRESETS) {
      const { defaultTextureId } = preset.values;
      if (defaultTextureId !== undefined) {
        expect(ALL_TEXTURE_IDS.has(defaultTextureId), `Missing texture: ${defaultTextureId} in preset ${preset.id}`).toBe(true);
      }
    }
  });

  it('all wallTextureSetIds are valid or undefined', () => {
    const validSets = new Set(['stone-slate', 'wood-ashen', undefined]);
    for (const preset of DUNGEON_STYLE_PRESETS) {
      expect(validSets.has(preset.values.wallTextureSetId), `Invalid wallTextureSetId in preset ${preset.id}`).toBe(true);
    }
  });

  it('each preset has id, label, category, and values', () => {
    for (const preset of DUNGEON_STYLE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.category).toBeTruthy();
      expect(preset.values).toBeTruthy();
    }
  });
});

describe('SCATTER_PRESETS', () => {
  it('has 4 presets with unique ids', () => {
    expect(SCATTER_PRESETS).toHaveLength(4);
    const ids = SCATTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('all assetIds exist in TEXTURE_MANIFEST', () => {
    for (const preset of SCATTER_PRESETS) {
      for (const assetId of preset.values.assetIds ?? []) {
        expect(ALL_TEXTURE_IDS.has(assetId), `Missing asset: ${assetId} in preset ${preset.id}`).toBe(true);
      }
    }
  });

  it('each preset has at least one assetId', () => {
    for (const preset of SCATTER_PRESETS) {
      expect(preset.values.assetIds?.length).toBeGreaterThan(0);
    }
  });
});
