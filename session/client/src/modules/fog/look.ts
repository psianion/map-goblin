// What the Fog tab's Look zone says about the cloud: whether the DM has changed it, what, and how
// to draw a small still of it. Pure, so the words can be checked without a DOM.

import type { FogLook } from '@dnd/core/src/shared/fogLook';

/** The look's fields the sheet edits, by the name the sheet gives them, in reading order. */
const FIELDS: readonly [keyof FogLook, string][] = [
  ['base', 'colour'],
  ['wind', 'wind'],
  ['fade', 'edge softness'],
  ['glow', 'torch glow'],
  ['layers', 'layers'],
];

/** The names of the fields `look` changes from `authored`, in reading order. */
export function changedFields(look: FogLook, authored: FogLook): string[] {
  return FIELDS.filter(([key]) => JSON.stringify(look[key]) !== JSON.stringify(authored[key])).map(([, name]) => name);
}

/** "Colour and wind changed", "Colour, wind and layers changed", or "Unchanged". */
export function changedCaption(fields: readonly string[]): string {
  if (fields.length === 0) return 'Unchanged';
  const words = fields.length === 1 ? fields[0]! : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}`;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} changed`;
}

/** '#rrggbb' as 0..1 channels; anything unparseable reads as mid grey. */
const channels = (hex: string): [number, number, number] => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  const v = n ? parseInt(n, 16) : 0x808080;
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
};

/** One layer of the still: an SVG noise field cut into lobes and filled with the layer's tint. */
export interface PreviewStratum {
  baseFrequency: number;
  seed: number;
  /** The `feColorMatrix` values: every pixel the tint, its alpha a steep ramp on the noise. */
  matrix: string;
}

/** Per layer, low and wide to the tops: how fine its lobes are, and which noise it draws. */
const STRATA: readonly (readonly [number, number])[] = [
  [0.03, 11],
  [0.042, 7],
  [0.055, 4],
];

/** How hard the noise is cut into lobes: past this slope an edge reads as a cloud's, not a blur's. */
const LOBE_SLOPE = 6;

/**
 * A still of the cloud for the Look zone: the base colour under each layer's lobes, in that
 * layer's tint, more of them the stronger the layer. Fractal noise cut at a steep alpha ramp
 * reads as billowed cloud where soft gradients read as blur. A drawing of the look, not the shader.
 */
export function previewStrata(look: FogLook): PreviewStratum[] {
  return look.layers.map((layer, i) => {
    const [r, g, b] = channels(layer.tint);
    const [baseFrequency, seed] = STRATA[i] ?? STRATA[STRATA.length - 1]!;
    // Fractal noise sits round 0.5: a strength of 0.5 cuts there, 1 leaves most of the field cloud.
    const offset = -LOBE_SLOPE * (0.56 - 0.12 * Math.min(1, Math.max(0, layer.strength)));
    const matrix = `0 0 0 0 ${r.toFixed(3)} 0 0 0 0 ${g.toFixed(3)} 0 0 0 0 ${b.toFixed(3)} ${LOBE_SLOPE} 0 0 0 ${offset.toFixed(3)}`;
    return { baseFrequency, seed, matrix };
  });
}
