import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composePieces, type ComposeInput } from './pipeline.js';

async function makeSprite(): Promise<Buffer> {
  return sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 120, g: 80, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('composePieces', () => {
  it('generates wall-straight pieces at requested sizes', async () => {
    const input: ComposeInput = {
      material: 'stone-cobble',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
        { id: 'b', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'straight', sizes: ['1x1', '2x1'], variantCount: 2 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    // 2 sizes × 2 variants = 4 pieces
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.outputData instanceof Buffer)).toBe(true);
  });

  it('generates corner pieces', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'corner-90', sizes: ['1x1'], variantCount: 1 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results).toHaveLength(1);
  });

  it('returns empty array when targets is empty', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results).toEqual([]);
  });

  it('returns empty array when variantCount is 0', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'straight', sizes: ['1x1'], variantCount: 0 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results).toEqual([]);
  });

  it('assigns variant letters A-E for first 5 variants', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
        { id: 'b', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'straight', sizes: ['1x1'], variantCount: 3 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results.map((r) => r.variant)).toEqual(['A', 'B', 'C']);
  });

  it('falls back to V-prefix for variants beyond E', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'straight', sizes: ['1x1'], variantCount: 7 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results[5]?.variant).toBe('V5');
    expect(results[6]?.variant).toBe('V6');
  });

  it('produces correct piece metadata for each result', async () => {
    const input: ComposeInput = {
      material: 'stone',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'straight', sizes: ['2x1'], variantCount: 1 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results[0]?.pieceType).toBe('straight');
    expect(results[0]?.size).toBe('2x1');
    expect(results[0]?.variant).toBe('A');
    expect(results[0]?.outputData).toBeInstanceOf(Buffer);
  });

  it('generates corner-120 and corner-135 pieces', async () => {
    const input: ComposeInput = {
      material: 'brick',
      sprites: [
        { id: 'a', data: await makeSprite(), width: 200, height: 200 },
      ],
      targets: [
        { pieceType: 'corner-120', sizes: ['1x1'], variantCount: 1 },
        { pieceType: 'corner-135', sizes: ['1x1'], variantCount: 1 },
      ],
      gridPixels: 200,
    };

    const results = await composePieces(input);
    expect(results).toHaveLength(2);
    expect(results[0]?.pieceType).toBe('corner-120');
    expect(results[1]?.pieceType).toBe('corner-135');
  });
});
