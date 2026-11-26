import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_CAP_BYTES, ART_PX, CENTRED, clampCrop, coverRect, encodeArt } from './artCrop';

afterEach(() => vi.restoreAllMocks());

describe('coverRect', () => {
  it('fills the square with the short side at zoom 1, centred', () => {
    expect(coverRect(800, 400, CENTRED, 512)).toEqual({ x: -256, y: 0, w: 1024, h: 512 });
  });

  it('moves the picture by circle diameters and scales by the zoom', () => {
    const r = coverRect(400, 400, { zoom: 2, x: 0.25, y: -0.25 }, 100);
    expect(r).toEqual({ x: -25, y: -75, w: 200, h: 200 });
  });
});

describe('clampCrop', () => {
  it('keeps the zoom between 1 and 4', () => {
    expect(clampCrop(100, 100, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
    expect(clampCrop(100, 100, { zoom: 9, x: 0, y: 0 }).zoom).toBe(4);
  });

  it('never lets the picture uncover the circle', () => {
    // A square at zoom 1 cannot move at all; a 2:1 picture moves half a diameter sideways.
    expect(clampCrop(100, 100, { zoom: 1, x: 0.3, y: -0.3 })).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop(200, 100, { zoom: 1, x: 0.9, y: 0.2 })).toEqual({ zoom: 1, x: 0.5, y: 0 });
  });
});

describe('encodeArt', () => {
  function fakeCanvas(blob: Blob | null) {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, imageSmoothingQuality: 'low' }),
      toBlob: vi.fn((done: (b: Blob | null) => void, _type?: string) => done(blob)),
    };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : real(tag)) as typeof document.createElement);
    return { canvas, drawImage };
  }
  const img = { naturalWidth: 1000, naturalHeight: 500 } as HTMLImageElement;

  it('draws a 512 px square as WebP, under the upload cap', async () => {
    const { canvas, drawImage } = fakeCanvas(new Blob([new Uint8Array(40_000)], { type: 'image/webp' }));
    const out = await encodeArt(img, CENTRED);
    expect([canvas.width, canvas.height]).toEqual([ART_PX, ART_PX]);
    expect(canvas.toBlob.mock.calls[0][1]).toBe('image/webp');
    expect(drawImage).toHaveBeenCalledWith(img, -256, 0, 1024, 512);
    expect(out.type).toBe('image/webp');
    expect(out.size).toBeLessThanOrEqual(ART_CAP_BYTES);
  });

  it('takes the PNG a browser without WebP encoding hands back', async () => {
    fakeCanvas(new Blob([new Uint8Array(10)], { type: 'image/png' }));
    expect((await encodeArt(img, CENTRED)).type).toBe('image/png');
  });

  it('refuses a picture over the cap rather than send one the server turns away', async () => {
    fakeCanvas(new Blob([new Uint8Array(ART_CAP_BYTES + 1)], { type: 'image/png' }));
    await expect(encodeArt(img, CENTRED)).rejects.toThrow(/too large/);
  });
});
