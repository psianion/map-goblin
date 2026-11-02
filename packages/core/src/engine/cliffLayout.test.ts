import { describe, it, expect } from 'vitest';
import { ledgePieces } from '../assets/caveWallKit';
import { CORNER_REACH, LEDGE_OUT, splitAtCorners, tileStraight } from './cliffLayout';

const straights = ledgePieces().filter((p) => p.turnDeg === 0 && !p.flipY);
type Vec = [number, number];

describe('splitAtCorners', () => {
  it('cuts a square into four straight edges', () => {
    const runs = splitAtCorners([[0, 0], [4, 0], [4, 4], [0, 4]], true);
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.straight && r.points.length === 2)).toBe(true);
  });

  it('keeps collinear points inside one straight edge', () => {
    const runs = splitAtCorners([[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]], true);
    expect(runs).toHaveLength(4);
    expect(runs[0].points).toHaveLength(3);
    expect(runs[0].straight).toBe(true);
  });

  it('hands a circle to the walk whole', () => {
    const circle = Array.from({ length: 48 }, (_, i): Vec => [3 * Math.cos((i / 48) * 2 * Math.PI), 3 * Math.sin((i / 48) * 2 * Math.PI)]);
    const runs = splitAtCorners(circle, true);
    expect(runs).toEqual([{ points: circle, straight: false, closed: true }]);
  });
});

describe('tileStraight', () => {
  const span = (ps: ReturnType<typeof tileStraight>) =>
    ps.reduce((sum, p) => sum + straights.find((s) => s.key === p.key)!.chordCells * p.stretch, 0);

  it('covers an edge end to end, past both corners, at close to the art’s own length', () => {
    const ps = tileStraight([0, 0], [4, 0], straights);
    expect(span(ps)).toBeCloseTo(4 + 2 * CORNER_REACH);
    expect(ps.every((p) => p.stretch > 0.8 && p.stretch < 1.25)).toBe(true);
  });

  it('lays the rock on the low side: the left of travel', () => {
    // Walking +x, left is -y in screen space: the rock sits just above the line.
    const ps = tileStraight([0, 0], [4, 0], straights);
    expect(ps.every((p) => p.normal[0] === 0 && p.normal[1] === -1)).toBe(true);
    expect(ps.every((p) => p.centre[1] < 0 && p.centre[1] > -LEDGE_OUT * 2)).toBe(true);
  });

  it('fits a short pit edge with one piece', () => {
    const ps = tileStraight([0, 0], [1.5, 0], straights, [], [0, 0]);
    expect(ps).toHaveLength(1);
    expect(span(ps)).toBeCloseTo(1.5);
  });

  it('leaves an opening bare', () => {
    const ps = tileStraight([0, 0], [6, 0], straights, [{ position: [3, 0], width: 2 }], [0, 0]);
    expect(span(ps)).toBeCloseTo(4);
    expect(ps.every((p) => Math.abs(p.centre[0] - 3) > 1)).toBe(true);
  });
});
