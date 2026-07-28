import type { GridSize } from '../types.js';
import { composeStraight, type LayoutSprite } from './layout.js';
import { composeCorner } from './corner.js';
import { generateVariantSeed, shuffleWithSeed } from './variants.js';

const CORNER_ANGLES: Record<string, 90 | 120 | 135> = {
  'corner-90': 90,
  'corner-120': 120,
  'corner-135': 135,
};

export interface SpriteInput {
  id: string;
  data: Buffer;
  width: number;
  height: number;
}

export interface TargetPiece {
  pieceType: string;
  sizes: GridSize[];
  variantCount: number;
}

export interface ComposeInput {
  material: string;
  sprites: SpriteInput[];
  targets: TargetPiece[];
  gridPixels: number;
}

export interface PieceResult {
  pieceType: string;
  size: GridSize;
  variant: string;
  outputData: Buffer;
}

function parseGridSize(gs: GridSize): { w: number; h: number } {
  const [w, h] = gs.split('x').map(Number);
  return { w: w!, h: h! };
}

export async function composePieces(
  input: ComposeInput,
): Promise<PieceResult[]> {
  const results: PieceResult[] = [];
  const variantLetters = 'ABCDE';

  for (const target of input.targets) {
    for (const size of target.sizes) {
      const { w, h } = parseGridSize(size);
      const targetWidth = w * input.gridPixels;
      const targetHeight = h * input.gridPixels;

      for (let v = 0; v < target.variantCount; v++) {
        const variant = variantLetters[v] ?? `V${v}`;
        const seed = generateVariantSeed(
          input.material,
          target.pieceType,
          variant,
        );
        const shuffled = shuffleWithSeed(input.sprites, seed);
        const layoutSprites: LayoutSprite[] = shuffled.map((s) => ({
          id: s.id,
          data: s.data,
          width: s.width,
          height: s.height,
        }));

        let outputData: Buffer;

        if (CORNER_ANGLES[target.pieceType]) {
          const straight = await composeStraight(layoutSprites, {
            targetWidth: input.gridPixels,
            targetHeight: input.gridPixels,
          });
          outputData = await composeCorner(straight, {
            angleDeg: CORNER_ANGLES[target.pieceType]!,
            outputSize: input.gridPixels,
          });
        } else {
          outputData = await composeStraight(layoutSprites, {
            targetWidth,
            targetHeight,
          });
        }

        results.push({
          pieceType: target.pieceType,
          size,
          variant,
          outputData,
        });
      }
    }
  }

  return results;
}
