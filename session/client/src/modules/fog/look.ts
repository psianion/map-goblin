// What the Fog tab's Look zone says about the cloud: whether the DM has changed it, what, and a
// small still of it. Pure, so the words can be checked without a DOM.

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

/** '#rrggbb' at an alpha, as a CSS colour; anything unparseable reads as transparent. */
const withAlpha = (hex: string, alpha: number): string => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!n) return 'transparent';
  const v = parseInt(n, 16);
  return `rgb(${(v >> 16) & 0xff} ${(v >> 8) & 0xff} ${v & 0xff} / ${Math.round(Math.min(1, Math.max(0, alpha)) * 100)}%)`;
};

/** Where each layer's lobes sit in the still: low and wide, then the middle, then the tops. */
const LOBES: readonly (readonly [number, number, number])[][] = [
  [
    [18, 78, 62],
    [72, 88, 58],
  ],
  [
    [40, 48, 46],
    [88, 40, 40],
  ],
  [
    [22, 24, 34],
    [62, 14, 30],
  ],
];

/**
 * A still of the cloud for the Look zone: the base colour under a few soft lobes per layer, each
 * in that layer's tint at its strength. A drawing of the look, not the shader.
 */
export function previewBackground(look: FogLook): string {
  const lobes = look.layers.flatMap((layer, i) =>
    (LOBES[i] ?? []).map(
      ([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, ${withAlpha(layer.tint, 0.35 + 0.6 * layer.strength)} 0, transparent ${r}%)`,
    ),
  );
  return [...lobes.reverse(), look.base].join(', ');
}
