// src/io/imageEmbed.ts
// Utilities for encoding custom uploaded images to base64 for save file embedding.
// Resize limit: 2048x2048 max before encoding.

export const MAX_EMBED_DIMENSION = 2048;

/** Returns true if the string is a data URL (data:...) */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

/** Encode a Blob to a base64 data URL string. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('blobToBase64: FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Decode a pure base64 string (no data URL prefix) to Uint8Array. */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Returns true if either dimension exceeds MAX_EMBED_DIMENSION. */
export function needsResize(width: number, height: number): boolean {
  return width > MAX_EMBED_DIMENSION || height > MAX_EMBED_DIMENSION;
}

/** Get image dimensions from a data URL. Returns null if load fails. */
export function getImageDimensions(
  src: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Resize a data URL image to fit within MAX_EMBED_DIMENSION, preserving aspect ratio.
 * Uses Canvas 2D — must be called in a browser context.
 */
export async function resizeImage(
  dataUrl: string,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.85,
): Promise<string> {
  const dims = await getImageDimensions(dataUrl);
  if (!dims) throw new Error('resizeImage: failed to load image dimensions');
  const { width, height } = dims;
  if (!needsResize(width, height)) return dataUrl;
  const scale = MAX_EMBED_DIMENSION / Math.max(width, height);
  const targetW = Math.floor(width * scale);
  const targetH = Math.floor(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('resizeImage: could not get 2D canvas context');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    img.onerror = () => reject(new Error('resizeImage: image load failed'));
    img.src = dataUrl;
  });
}

/**
 * Prepare a custom image URL for embedding in a save file.
 * Fetches non-data URLs, converts to base64, resizes if oversized.
 */
export async function prepareImageForEmbed(url: string): Promise<string> {
  let dataUrl: string;
  if (isDataUrl(url)) {
    dataUrl = url;
  } else {
    const response = await fetch(url);
    const blob = await response.blob();
    dataUrl = await blobToBase64(blob);
  }
  const dims = await getImageDimensions(dataUrl);
  if (dims && needsResize(dims.width, dims.height)) {
    const mimeType = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
    dataUrl = await resizeImage(dataUrl, mimeType);
  }
  return dataUrl;
}

/**
 * Restore custom images from a save file's customImages map into PIXI.Assets.
 * Must be called BEFORE loadFromFile() restores the layer state.
 */
export async function restoreCustomImages(customImages: Record<string, string>): Promise<void> {
  if (!customImages || Object.keys(customImages).length === 0) return;
  const { Assets } = await import('pixi.js');
  for (const [id, dataUrl] of Object.entries(customImages)) {
    try {
      if (Assets.cache.has(id)) continue;
      const texture = await Assets.load({ alias: id, src: dataUrl });
      if (!texture) {
        console.warn('[restoreCustomImages] Failed to load texture for ID:', id);
      }
    } catch (err) {
      console.warn('[restoreCustomImages] Error loading asset', id, err);
    }
  }
}
