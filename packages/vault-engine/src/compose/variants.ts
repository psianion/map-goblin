import { hashCombine } from '../hash.js';

export function generateVariantSeed(
  material: string,
  pieceType: string,
  variant: string,
): number {
  let h = 0;
  for (let i = 0; i < material.length; i++) {
    h = hashCombine(h, material.charCodeAt(i));
  }
  for (let i = 0; i < pieceType.length; i++) {
    h = hashCombine(h, pieceType.charCodeAt(i));
  }
  h = hashCombine(h, variant.charCodeAt(0));
  return h;
}

export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0;

  for (let i = arr.length - 1; i > 0; i--) {
    s = ((s * 1664525 + 1013904223) >>> 0);
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }

  return arr;
}
