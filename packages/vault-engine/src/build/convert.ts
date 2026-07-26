// packages/engine/src/build/convert.ts
import sharp from 'sharp';
import type { AssetType } from '../types.js';

type QualityProfile = 'texture' | 'object' | 'light-mask';

/** Quality settings per profile (from spec section 8.2) */
const QUALITY: Record<QualityProfile, { quality: number; lossless: boolean }> = {
  texture: { quality: 85, lossless: false },
  object: { quality: 90, lossless: false },
  'light-mask': { quality: 100, lossless: true },
};

/** Map asset type to quality profile */
const TYPE_PROFILE: Record<AssetType, QualityProfile> = {
  floor: 'texture',
  wall: 'texture',
  pattern: 'texture',
  edge: 'texture',
  scatter: 'texture',
  object: 'object',
  portal: 'object',
  path: 'object',
  'light-mask': 'light-mask',
};

export function getQualityProfile(assetType: AssetType): QualityProfile {
  return TYPE_PROFILE[assetType];
}

export async function convertToWebP(
  imageData: Buffer,
  profile: QualityProfile,
): Promise<Buffer> {
  const { quality, lossless } = QUALITY[profile];
  return sharp(imageData)
    .webp({ quality, lossless })
    .toBuffer();
}
