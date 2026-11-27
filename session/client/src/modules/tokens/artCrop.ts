// The geometry and drawing behind the token picture editor (`TokenArtEditor.tsx`): where a
// picture sits inside the token's circle, and the 512 px square it is saved as.

/** The side of the saved picture, in pixels. */
export const ART_PX = 512;
/** The upload route's cap (`POST /api/campaigns/:id/assets`). */
export const ART_CAP_BYTES = 2 * 1024 * 1024;
export const MAX_ZOOM = 4;

/** The ten ring colours offered, then "no ring". The first eight are the seat colours. */
export const RING_COLOURS = [
  '#2f7dd1',
  '#c2410c',
  '#15803d',
  '#9333ea',
  '#be185d',
  '#0f766e',
  '#a16207',
  '#4f46e5',
  '#e5e5e5',
  '#262626',
] as const;
export const NO_RING = 'none';

/**
 * How the picture sits in the circle: `zoom` 1 just covers it, and `x`, `y` move the
 * picture's centre from the circle's, in circle diameters.
 */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export const CENTRED: Crop = { zoom: 1, x: 0, y: 0 };

/** Where to draw a `w` by `h` picture so it fills a `size` square as `crop` says. */
export function coverRect(w: number, h: number, crop: Crop, size: number): { x: number; y: number; w: number; h: number } {
  const scale = (size / Math.max(1, Math.min(w, h))) * crop.zoom;
  const dw = w * scale;
  const dh = h * scale;
  return { x: size / 2 + crop.x * size - dw / 2, y: size / 2 + crop.y * size - dh / 2, w: dw, h: dh };
}

/** Keeps the zoom in range and the picture over the whole circle. */
export function clampCrop(w: number, h: number, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const short = Math.max(1, Math.min(w, h));
  const maxX = ((w / short) * zoom - 1) / 2;
  const maxY = ((h / short) * zoom - 1) / 2;
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v)) || 0;
  return { zoom, x: clamp(crop.x, maxX), y: clamp(crop.y, maxY) };
}

/**
 * Draws the crop into a 512 px square and encodes it as WebP. A browser that cannot encode
 * WebP hands back PNG from the same call, which the upload route also takes.
 */
export async function encodeArt(img: HTMLImageElement, crop: Crop): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = ART_PX;
  canvas.height = ART_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the picture.');
  const r = coverRect(img.naturalWidth, img.naturalHeight, crop, ART_PX);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error('The picture could not be saved.');
  if (blob.size > ART_CAP_BYTES) throw new Error('The picture is too large to upload.');
  return blob;
}
