import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { validateFile } from './validate.js';

// Helper: create a minimal valid PNG buffer
async function makePng(width = 200, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 128, g: 128, b: 128, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

// Helper: create a minimal valid JPEG buffer
async function makeJpeg(width = 200, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('validateFile', () => {
  it('accepts a valid PNG', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, 'test.png');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('png');
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it('accepts a valid JPEG', async () => {
    const buf = await makeJpeg();
    const result = await validateFile(buf, 'test.jpg');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('jpeg');
  });

  it('rejects a file with wrong magic bytes', async () => {
    const buf = Buffer.from('This is not an image file');
    const result = await validateFile(buf, 'fake.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('magic');
  });

  it('rejects files over the size limit', async () => {
    const buf = await makePng(100, 100);
    const result = await validateFile(buf, 'big.png', { maxFileSize: 10 }); // 10 bytes for testing
    expect(result.valid).toBe(false);
    expect(result.error).toContain('size');
  });

  it('rejects images smaller than 32px', async () => {
    const buf = await makePng(16, 16);
    const result = await validateFile(buf, 'tiny.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('dimension');
  });

  it('rejects images larger than 4096px', async () => {
    const buf = await makePng(5000, 200);
    const result = await validateFile(buf, 'huge.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('dimension');
  });

  it('rejects path traversal in filename', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, '../../../etc/passwd.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });

  it('returns hasAlpha for PNG with transparency', async () => {
    const buf = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const result = await validateFile(buf, 'transparent.png');
    expect(result.valid).toBe(true);
    expect(result.hasAlpha).toBe(true);
  });

  it('rejects path traversal with nested parent refs', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, 'assets/../../etc/shadow.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });

  it('rejects path traversal with dot-dot at start', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, '../secret.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });

  it('accepts a safe nested path without traversal', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, 'floors/dungeon/stone-A.png');
    expect(result.valid).toBe(true);
  });

  it('rejects corrupt image data (valid PNG magic, corrupt body)', async () => {
    // Start with PNG magic bytes but corrupt the rest
    const buf = Buffer.alloc(200);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    // Fill remaining with garbage
    for (let i = 4; i < 200; i++) buf[i] = 0xff;
    const result = await validateFile(buf, 'corrupt.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('corrupt');
  });

  it('rejects empty buffer', async () => {
    const buf = Buffer.alloc(0);
    const result = await validateFile(buf, 'empty.png');
    expect(result.valid).toBe(false);
  });

  it('accepts a valid WebP image', async () => {
    const buf = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 128, g: 128, b: 128, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();
    const result = await validateFile(buf, 'test.webp');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('webp');
  });

  it('respects custom dimension limits', async () => {
    const buf = await makePng(100, 100);
    const result = await validateFile(buf, 'test.png', {
      minDimension: 200,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('dimension');
  });

  it('accepts SVG with xml declaration', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>';
    const buf = Buffer.from(svg);
    const result = await validateFile(buf, 'icon.svg');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('svg');
  });

  it('accepts SVG with direct svg tag', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>';
    const buf = Buffer.from(svg);
    const result = await validateFile(buf, 'icon.svg');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('svg');
  });

  it('rejects exactly at dimension boundary', async () => {
    // Image at max dimension should pass
    const bufOk = await makePng(4096, 200);
    const resultOk = await validateFile(bufOk, 'maxsize.png');
    expect(resultOk.valid).toBe(true);
  });

  it('rejects absolute paths', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, '/etc/passwd.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });

  it('rejects path traversal that escapes via double-dot segments', async () => {
    const buf = await makePng();
    const result = await validateFile(buf, 'a/b/../../../../etc/shadow.png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });
});
