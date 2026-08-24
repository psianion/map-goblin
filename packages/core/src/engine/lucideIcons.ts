/**
 * Lucide glyphs rasterized for Pixi sprites (path data from lucide v0.577.0, ISC licence).
 *
 * Glyphs are drawn white on a 24-unit grid with a dark halo underlay baked in, so a tinted
 * Sprite stays legible over both lit stone and night fog (tint multiplies: the halo stays dark).
 * Textures are cached per glyph+size; tint at the Sprite, never re-rasterize per colour.
 */
import { Texture } from 'pixi.js';

const GLYPHS = {
  lightbulb: [
    'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
    'M9 18h6',
    'M10 22h4',
  ],
  'lightbulb-off': [
    'M16.8 11.2c.8-.9 1.2-2 1.2-3.2a6 6 0 0 0-9.3-5',
    'm2 2 20 20',
    'M6.3 6.3a4.67 4.67 0 0 0 1.2 5.2c.7.7 1.3 1.5 1.5 2.5',
    'M9 18h6',
    'M10 22h4',
  ],
  'door-open': [
    'M11 20H2',
    'M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z',
    'M11 4H8a2 2 0 0 0-2 2v14',
    'M14 12h.01',
    'M22 20h-3',
  ],
  'door-closed': [
    'M10 12h.01',
    'M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14',
    'M2 20h20',
  ],
} as const;

export type LucideGlyph = keyof typeof GLYPHS;

const cache = new Map<string, Texture>();

/** White lucide glyph at `sizePx` square (device-pixel scaled). Tint the Sprite for colour. */
export function lucideTexture(glyph: LucideGlyph, sizePx: number): Texture {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const key = `${glyph}:${sizePx}:${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof Path2D === 'undefined') {
    cache.set(key, Texture.WHITE); // jsdom / test env — no 2D canvas
    return Texture.WHITE;
  }
  const px = Math.max(1, Math.round(sizePx * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;
  ctx.scale(px / 24, px / 24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const paths = GLYPHS[glyph].map((d) => new Path2D(d));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 3.5;
  for (const p of paths) ctx.stroke(p);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (const p of paths) ctx.stroke(p);
  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}
