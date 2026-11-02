import { useRef, useEffect } from 'react';
import type { Texture } from 'pixi.js';
import { load, resolveTexture } from '@/assets/textureLoader';
import { thumbnailCrop, type ThumbnailFit } from './thumbnailCrop';

function draw(canvas: HTMLCanvasElement, tex: Texture, fit: ThumbnailFit): void {
  const source = tex.source?.resource as HTMLImageElement | ImageBitmap | undefined;
  if (!source) return;

  const crop = thumbnailCrop(tex.frame, fit);
  const size = Math.min(128, Math.max(crop.width, crop.height));
  const scale = size / Math.max(crop.width, crop.height);
  canvas.width = Math.round(crop.width * scale);
  canvas.height = Math.round(crop.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(
    source as CanvasImageSource,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, canvas.width, canvas.height,
  );
}

/**
 * Renders a pack texture (atlas frame) to a canvas for thumbnail display. `fit="cover"`
 * crops the largest centred square, so a long thin piece fills the tile with its material.
 * A texture still loading is drawn when it arrives.
 */
export function PackThumbnailCanvas({ textureId, fit = 'contain' }: { textureId: string; fit?: ThumbnailFit }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tex = resolveTexture(textureId);
    if (tex && tex.width > 1) {
      draw(canvas, tex, fit);
      return;
    }
    if (!textureId.includes(':') || textureId.startsWith('data:') || textureId.startsWith('blob:')) return;

    // The pack is still installing or rehydrating: draw once the texture lands.
    let live = true;
    void load(textureId).then((loaded) => {
      if (live && loaded.width > 1 && canvasRef.current) draw(canvasRef.current, loaded, fit);
    });
    return () => {
      live = false;
    };
  }, [textureId, fit]);

  return <canvas ref={canvasRef} className="h-full w-full object-contain" />;
}
