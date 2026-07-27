import { useRef, useEffect } from 'react';
import { resolveTexture } from '@/assets/textureLoader';

/** Renders a pack texture (atlas frame) to a canvas for thumbnail display. */
export function PackThumbnailCanvas({ textureId }: { textureId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tex = resolveTexture(textureId);
    if (!tex || tex.width <= 1) return;

    const source = tex.source?.resource as HTMLImageElement | ImageBitmap | undefined;
    if (!source) return;

    const frame = tex.frame;
    const size = Math.min(128, Math.max(frame.width, frame.height));
    const scale = size / Math.max(frame.width, frame.height);
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      source as CanvasImageSource,
      frame.x, frame.y, frame.width, frame.height,
      0, 0, canvas.width, canvas.height,
    );
  }, [textureId]);

  return <canvas ref={canvasRef} className="h-full w-full object-contain" />;
}
