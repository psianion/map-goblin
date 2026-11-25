// packages/engine/src/build/lights.ts
//
// Light props: the object entries that bring a light when placed, which preset that light
// takes, and which sibling entries are the prop's pictures with the light off, as embers and
// on. Written from an explicit table, never guessed from names: the `light` tag also covers
// cooking spits, pots and log rings, which give no light.
import type { LightPresetId, ManifestEntry, PackManifest } from '../schemas/pack-manifest.js';

/** One light prop in the table: its preset and its pictures by state, as entry materials. */
export interface LightPropRow {
  preset: LightPresetId;
  /** Pictures by state. A row with only `fixed` keeps one picture whatever its light does. */
  off?: string;
  embers?: string;
  on?: string;
  fixed?: string;
}

const pair = (preset: LightPresetId, on: string, off: string): LightPropRow => ({ preset, on, off });
const brazier = (n: number): LightPropRow => ({
  preset: 'brazier',
  off: `light_brazier_${n}_a`,
  embers: `light_brazier_${n}_b`,
  on: `light_brazier_${n}_c`,
});
const fixed = (preset: LightPresetId, material: string): LightPropRow => ({ preset, fixed: material });

/** The gg-demo light props (plan section A). Every material named here must exist in the pack. */
export const LIGHT_PROPS: readonly LightPropRow[] = [
  pair('candle', 'light_candle_cluster_lit', 'light_candle_cluster_unlit'),
  pair('candle', 'light_candle_large_lit', 'light_candle_large_unlit'),
  pair('candle', 'light_candle_small_lit', 'light_candle_small_unlit'),
  pair('candle', 'light_candle_stand_lit', 'light_candle_stand_unlit'),
  pair('candle', 'light_candle_stand_small_lit', 'light_candle_stand_small_unlit'),
  pair('lantern', 'light_chandelier_1_lit_gold', 'light_chandelier_1_unlit_gold'),
  pair('lantern', 'light_chandelier_2_lit_iron', 'light_chandelier_2_unlit_iron'),
  pair('lantern', 'light_chandelier_3_lit_gold', 'light_chandelier_3_unlit_gold'),
  pair('lantern', 'light_chandelier_4_lit_iron', 'light_chandelier_4_unlit_iron'),
  pair('lantern', 'light_chandelier_antler_lit', 'light_chandelier_antler_unlit'),
  pair('lantern', 'light_lantern_lit', 'light_lantern_unlit'),
  pair('torch', 'light_stand_lit_iron', 'light_stand_unlit_iron'),
  brazier(1),
  brazier(2),
  brazier(3),
  fixed('candle', 'candle_1'),
  fixed('candle', 'candle_2'),
  fixed('candle', 'clutter_light_candle'),
  fixed('candle', 'clutter_pumpkin_jack_o_lantern'),
  fixed('lantern', 'lantern'),
  fixed('lantern', 'clutter_light_lantern'),
  fixed('brazier', 'campfire'),
  fixed('brazier', 'campfire_fire'),
  fixed('brazier', 'fireplace'),
];

const STATES = ['off', 'embers', 'on'] as const;

/** Every material a row names. */
function materialsOf(row: LightPropRow): string[] {
  return [row.fixed, ...STATES.map((s) => row[s])].filter((m): m is string => m !== undefined);
}

/**
 * Writes `light` on every object entry the table lists: the row's preset, and for a row with
 * pictures, the entry key of each state's picture (the sibling with the same grid size,
 * piece type and variant). Entries the table does not list are left as they are, and a
 * table material the pack does not hold, or holds more than once, throws.
 */
export function addLights(manifest: PackManifest, rows: readonly LightPropRow[] = LIGHT_PROPS): PackManifest {
  const byMaterial = new Map<string, string[]>();
  for (const [key, e] of Object.entries(manifest.entries)) {
    if (e.type !== 'object') continue;
    const list = byMaterial.get(e.material);
    if (list) list.push(key);
    else byMaterial.set(e.material, [key]);
  }
  const keyOf = (material: string): string => {
    const keys = byMaterial.get(material) ?? [];
    if (keys.length !== 1) throw new Error(`Light table: "${material}" matches ${keys.length} object entries, expected 1`);
    return keys[0]!;
  };

  const lights = new Map<string, NonNullable<ManifestEntry['light']>>();
  for (const row of rows) {
    if (row.fixed) {
      lights.set(keyOf(row.fixed), { preset: row.preset });
      continue;
    }
    const states: { off?: string; embers?: string; on?: string } = {};
    for (const s of STATES) if (row[s]) states[s] = keyOf(row[s]!);
    for (const m of materialsOf(row)) lights.set(keyOf(m), { preset: row.preset, states });
  }

  const entries: PackManifest['entries'] = {};
  for (const [key, entry] of Object.entries(manifest.entries)) {
    const light = lights.get(key);
    entries[key] = light ? { ...entry, light } : entry;
  }
  return { ...manifest, entries };
}
