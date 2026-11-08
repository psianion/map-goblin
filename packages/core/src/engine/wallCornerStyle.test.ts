import { describe, it, expect, vi } from 'vitest';
import { elbowsFor, junctionCornerStyle, layoutWall, type WallPieceSpec } from './wallLayout';
import { cornerShapeOf } from './wallNodeRenderer';

const straight: WallPieceSpec = { id: 'straight-1x1', role: 'straight', lengthPx: 200, thicknessPx: 60 };
const sharp: WallPieceSpec = { id: 'corner-sharp', role: 'corner', lengthPx: 200, thicknessPx: 60, authoredTurn: Math.PI / 2, cornerShape: 'sharp' };
const round: WallPieceSpec = { id: 'corner-round', role: 'corner', lengthPx: 200, thicknessPx: 60, authoredTurn: Math.PI / 2, cornerShape: 'rounded' };
const swapOnly: WallPieceSpec = { ...round, id: 'corner-swap', swapOnly: true };

/** An L: one 90° turn at (4, 0). */
const L: [number, number][] = [[0, 0], [4, 0], [4, 4]];
const cornerOf = (pieces: WallPieceSpec[], cornerStyle?: 'rounded' | 'sharp') =>
  layoutWall(L, false, pieces, { wallWidth: 0.5, seed: 3, cornerStyle }).find((n) => n.kind === 'corner')?.pieceId;

describe('corner style: the piece a turn takes', () => {
  it('takes the rounded piece for a rounded wall and the sharp one for a sharp wall', () => {
    expect(elbowsFor([straight, sharp, round], 'rounded')).toEqual([round]);
    expect(elbowsFor([straight, sharp, round], 'sharp')).toEqual([sharp]);
    expect(cornerOf([straight, sharp, round], 'rounded')).toBe('corner-round');
    expect(cornerOf([straight, sharp, round], 'sharp')).toBe('corner-sharp');
  });

  it('is sharp when the style is left out, and never offers a swap-only piece', () => {
    expect(cornerOf([straight, sharp, round])).toBe('corner-sharp');
    expect(elbowsFor([straight, swapOnly, sharp], 'rounded')).toEqual([sharp]);
  });

  it('falls back to sharp, with a warning, when the set has no rounded piece', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cornerOf([straight, sharp], 'rounded')).toBe('corner-sharp');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('lays no authored piece, and does not throw, when the set has no corner at all', () => {
    expect(elbowsFor([straight], 'rounded')).toEqual([]);
    expect(() => cornerOf([straight], 'rounded')).not.toThrow();
    expect(cornerOf([straight, round], 'sharp')).not.toBe('corner-round');
  });

  it('rounds where two walls meet only when both are rounded', () => {
    expect(junctionCornerStyle('rounded', 'rounded')).toBe('rounded');
    expect(junctionCornerStyle('rounded', 'sharp')).toBe('sharp');
    expect(junctionCornerStyle('sharp', 'rounded')).toBe('sharp');
    expect(junctionCornerStyle('sharp', 'sharp')).toBe('sharp');
  });
});

describe('corner style: which pieces are rounded', () => {
  it('reads the GG sets by letter: A and C sharp, B, D and E rounded', () => {
    const shape = (letter: string) => cornerShapeOf({ tags: ['fantasy'], material: `GG_Fieldstone_Corner_${letter}_1x1` });
    expect(['A', 'B', 'C', 'D', 'E'].map(shape)).toEqual(['sharp', 'rounded', 'sharp', 'rounded', 'rounded']);
  });

  it("lets a pack's own tag win over the letter", () => {
    expect(cornerShapeOf({ tags: ['rounded'], material: 'GG_Palisade_Corner_C_1x1' })).toBe('rounded');
    expect(cornerShapeOf({ tags: ['sharp'], material: 'GG_Palisade_Corner_D_1x1' })).toBe('sharp');
    expect(cornerShapeOf({ tags: [], material: 'Thirdparty_Elbow' })).toBe('sharp');
  });
});
