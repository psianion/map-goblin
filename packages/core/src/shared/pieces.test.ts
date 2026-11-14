// A sized map's frame, the base ground a level draws, and where a piece covers and shows.
import { describe, it, expect } from 'vitest';
import type { ShapeChild } from './types';
import type { Polygon } from '../types/geometry';
import { baseGroundOf, inFrame, lockedFrame, pieceCovers, pieceShowsAt } from './pieces';

function piece(contours: Polygon[], extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id: 'p',
    name: 'p',
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  };
}

describe('lockedFrame and inFrame', () => {
  it('is the locked size from the origin, and nothing for a map that grows', () => {
    expect(lockedFrame({ fixedSize: { width: 20, height: 10, locked: true } })).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    expect(lockedFrame({ fixedSize: { width: 20, height: 10 } })).toBeNull();
    expect(lockedFrame({ fixedSize: null })).toBeNull();
  });

  it('counts the edge as on the frame', () => {
    const f = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
    expect(inFrame(f, 20, 10)).toBe(true);
    expect(inFrame(f, 20.01, 5)).toBe(false);
  });
});

describe('baseGroundOf', () => {
  it('is the map’s ground unless the level carries its own', () => {
    const map = { ground: { textureId: 'p:grass' } };
    expect(baseGroundOf(map)).toBe(map.ground);
    expect(baseGroundOf(map, { ground: null })).toBeNull();
    const own = { color: '#ffffff' };
    expect(baseGroundOf(map, { ground: own })).toBe(own);
    expect(baseGroundOf(map, {})).toBe(map.ground);
    expect(baseGroundOf({ ground: {} })).toBeNull();
  });
});

describe('pieceCovers and pieceShowsAt', () => {
  it('covers its outer ring less its own holes', () => {
    const holed = piece([
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[4, 4], [6, 4], [6, 6], [4, 6]],
    ]);
    expect(pieceCovers(holed, 2, 2)).toBe(true);
    expect(pieceCovers(holed, 5, 5)).toBe(false);
    expect(pieceCovers(holed, 12, 2)).toBe(false);
  });

  it('shows a patch kept to the floors only where the floors are', () => {
    const square: Polygon[] = [[[10, 0], [20, 0], [20, 10], [10, 10]]];
    const floor: Polygon[] = [[[0, 0], [15, 0], [15, 10], [0, 10]]];
    const kept = piece(square, { keptToFloors: true });
    expect(pieceShowsAt(kept, floor, 12, 5)).toBe(true);
    expect(pieceShowsAt(kept, floor, 18, 5)).toBe(false);
    expect(pieceShowsAt(kept, null, 18, 5)).toBe(true);
    expect(pieceShowsAt(piece(square), floor, 18, 5)).toBe(true);
  });
});
