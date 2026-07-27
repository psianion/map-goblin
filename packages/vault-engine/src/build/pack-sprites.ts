// packages/engine/src/build/pack-sprites.ts
import { MaxRectsPacker, type Rectangle } from 'maxrects-packer';
import sharp from 'sharp';

export interface SpriteInput {
  id: string;
  data: Buffer;
  width: number;
  height: number;
}

export interface PackOptions {
  maxSize: number;
  padding: number;
}

export interface FrameData {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
}

export interface AtlasResult {
  frames: Record<string, FrameData>;
  meta: {
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: string;
    related_multi_packs?: string[];
  };
  imageData: Buffer;
}

export interface PackResult {
  atlases: AtlasResult[];
}

export async function packSprites(
  sprites: SpriteInput[],
  opts: PackOptions,
): Promise<PackResult> {
  const packer = new MaxRectsPacker(opts.maxSize, opts.maxSize, opts.padding, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
  });

  // Add all sprites to packer
  const spriteMap = new Map<string, SpriteInput>();
  for (const sprite of sprites) {
    spriteMap.set(sprite.id, sprite);
    packer.add(sprite.width, sprite.height, { id: sprite.id });
  }

  const atlases: AtlasResult[] = [];

  for (let binIdx = 0; binIdx < packer.bins.length; binIdx++) {
    const bin = packer.bins[binIdx]!;
    const frames: Record<string, FrameData> = {};
    const composites: sharp.OverlayOptions[] = [];

    for (const rect of bin.rects as (Rectangle & { data: { id: string } })[]) {
      const id = rect.data.id;
      const sprite = spriteMap.get(id)!;

      frames[id] = {
        frame: { x: rect.x, y: rect.y, w: sprite.width, h: sprite.height },
        rotated: false,
        trimmed: false,
        sourceSize: { w: sprite.width, h: sprite.height },
        spriteSourceSize: { x: 0, y: 0, w: sprite.width, h: sprite.height },
      };

      composites.push({
        input: await sharp(sprite.data).ensureAlpha().raw().toBuffer(),
        raw: { width: sprite.width, height: sprite.height, channels: 4 },
        left: rect.x,
        top: rect.y,
      });
    }

    // Create atlas image
    const atlasWidth = bin.width;
    const atlasHeight = bin.height;

    const imageData = await sharp({
      create: {
        width: atlasWidth,
        height: atlasHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .webp({ quality: 90 })
      .toBuffer();

    atlases.push({
      frames,
      meta: {
        image: `atlas-${binIdx}.webp`,
        format: 'RGBA8888',
        size: { w: atlasWidth, h: atlasHeight },
        scale: '1',
      },
      imageData,
    });
  }

  // related_multi_packs is filled in by the caller, which owns the final filenames
  return { atlases };
}
