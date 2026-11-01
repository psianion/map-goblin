import { describe, it, expect } from 'vitest';
import { thumbnailCrop } from './thumbnailCrop';

describe('thumbnailCrop', () => {
  const band = { x: 10, y: 66, width: 200, height: 68 };

  it('contain keeps the whole frame', () => {
    expect(thumbnailCrop(band, 'contain')).toEqual(band);
  });

  it('cover takes the largest centred square', () => {
    expect(thumbnailCrop(band, 'cover')).toEqual({ x: 76, y: 66, width: 68, height: 68 });
    expect(thumbnailCrop({ x: 0, y: 0, width: 50, height: 150 }, 'cover')).toEqual({ x: 0, y: 50, width: 50, height: 50 });
  });
});
