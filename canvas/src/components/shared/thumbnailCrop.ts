export type ThumbnailFit = 'contain' | 'cover';

/** The part of a frame a thumbnail shows: all of it, or the largest centred square. */
export function thumbnailCrop(
  frame: { x: number; y: number; width: number; height: number },
  fit: ThumbnailFit,
): { x: number; y: number; width: number; height: number } {
  if (fit === 'contain') return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  const side = Math.min(frame.width, frame.height);
  return {
    x: frame.x + (frame.width - side) / 2,
    y: frame.y + (frame.height - side) / 2,
    width: side,
    height: side,
  };
}
