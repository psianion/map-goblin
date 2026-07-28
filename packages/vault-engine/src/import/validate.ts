import sharp from 'sharp';
import { normalize, resolve, isAbsolute, sep } from 'node:path';

/** Magic bytes for supported image formats. */
const MAGIC: Record<string, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF header
};

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MIN_DIMENSION = 32;
const MAX_DIMENSION = 4096;

export interface ValidateOptions {
  maxFileSize?: number;
  minDimension?: number;
  maxDimension?: number;
}

export interface ValidateResult {
  valid: boolean;
  format?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  error?: string;
}

function checkMagicBytes(buf: Buffer): string | null {
  for (const [fmt, bytes] of Object.entries(MAGIC)) {
    if (!bytes.every((b, i) => buf[i] === b)) continue;
    // RIFF is shared with WAV/AVI — bytes 8-11 are what make it a WebP
    if (fmt === 'webp' && buf.subarray(8, 12).toString('latin1') !== 'WEBP') continue;
    return fmt;
  }
  // SVG needs an actual <svg element, not just an XML declaration
  const head = buf.subarray(0, 256).toString('utf8');
  if (head.includes('<svg')) return 'svg';
  return null;
}

function hasPathTraversal(filename: string): boolean {
  const normalized = normalize(filename);
  // Reject absolute paths outright
  if (isAbsolute(normalized)) return true;
  // Resolve against a virtual root and verify the result stays inside
  const root = resolve('/safe-root');
  const resolved = resolve(root, normalized);
  // sep, not '/': resolve() returns backslash paths on Windows
  return !resolved.startsWith(root + sep) && resolved !== root;
}

export async function validateFile(
  data: Buffer,
  filename: string,
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const maxSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const minDim = opts.minDimension ?? MIN_DIMENSION;
  const maxDim = opts.maxDimension ?? MAX_DIMENSION;

  // Path traversal check
  if (hasPathTraversal(filename)) {
    return { valid: false, error: 'Invalid path: path traversal detected' };
  }

  // File size check
  if (data.length > maxSize) {
    return { valid: false, error: `File size ${data.length} exceeds max size ${maxSize}` };
  }

  // Magic number check
  const format = checkMagicBytes(data);
  if (!format) {
    return {
      valid: false,
      error: 'Unsupported format: magic bytes do not match PNG/JPEG/WebP/SVG',
    };
  }

  // SVG has no pixel dimensions, which every consumer downstream requires
  if (format === 'svg') {
    return { valid: false, error: 'SVG not supported (no pixel dimensions)' };
  }

  // Get image metadata via sharp
  try {
    const meta = await sharp(data).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (width < minDim || height < minDim) {
      return {
        valid: false,
        error: `Image dimension ${width}x${height} below minimum ${minDim}px`,
      };
    }
    if (width > maxDim || height > maxDim) {
      return {
        valid: false,
        error: `Image dimension ${width}x${height} exceeds maximum ${maxDim}px`,
      };
    }

    return {
      valid: true,
      format,
      width,
      height,
      hasAlpha: meta.hasAlpha ?? false,
    };
  } catch {
    return { valid: false, error: 'Failed to read image metadata (corrupt file?)' };
  }
}
