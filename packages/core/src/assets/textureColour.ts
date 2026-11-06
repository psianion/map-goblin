import type { Texture } from 'pixi.js';

const cache = new WeakMap<Texture, number | null>();

/**
 * A texture's average colour (0xRRGGBB), read once off its image through a small 2D canvas,
 * or null when it has no readable image (not loaded yet, or no canvas in this environment).
 * The stand-in colour wherever a material is wanted as a flat tone.
 */
export function averageColour(texture: Texture): number | null {
  if (cache.has(texture)) return cache.get(texture)!;
  const resource = texture.source?.resource as CanvasImageSource | undefined;
  if (!resource || texture.width <= 1) return null;
  let colour: number | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      const f = texture.frame;
      ctx.drawImage(resource, f.x, f.y, f.width, f.height, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255;
        r += px[i] * a;
        g += px[i + 1] * a;
        b += px[i + 2] * a;
        n += a;
      }
      if (n > 0) colour = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    }
  } catch {
    colour = null;
  }
  cache.set(texture, colour);
  return colour;
}
