import { describe, it, expect, beforeEach } from 'vitest';
import { editedOutline, editedCurvedRing } from './shapeNodeEdit';
import { useStore } from '../store/store';
import type { Polygon } from '../types/geometry';
import {
  edgeControls,
  flattenRing,
  pointOnCubic,
  type RingTangents,
} from '../shared/bezier';

const SQUARE: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

// editedOutline snaps through the live grid setting, so pin it.
beforeEach(() => {
  useStore.setState((s) => {
    s.grid.snapEnabled = false;
  });
});

describe('editedOutline', () => {
  it('moves one vertex and leaves the rest alone', () => {
    const out = editedOutline(SQUARE, { kind: 'move', index: 1, x: 14, y: -3 })!;
    expect(out).toEqual([[0, 0], [14, -3], [10, 10], [0, 10]]);
  });

  it('does not mutate the outline it was given', () => {
    editedOutline(SQUARE, { kind: 'move', index: 0, x: 99, y: 99 });
    expect(SQUARE[0]).toEqual([0, 0]);
  });

  // The user-visible case: a square gains a fifth corner and becomes an
  // irregular pentagon.
  it('inserts a vertex after the edge it was placed on', () => {
    const withNode = editedOutline(SQUARE, { kind: 'insert', index: 0, x: 5, y: 0 })!;
    expect(withNode).toHaveLength(5);
    expect(withNode[1]).toEqual([5, 0]);
    const pentagon = editedOutline(withNode, { kind: 'move', index: 1, x: 5, y: -4 })!;
    expect(pentagon).toEqual([[0, 0], [5, -4], [10, 0], [10, 10], [0, 10]]);
  });

  it('moves both ends of an edge together, keeping it parallel', () => {
    const out = editedOutline(SQUARE, { kind: 'moveEdge', index: 1, dx: 3, dy: 0 })!;
    // Edge 1 is [10,0] → [10,10]; both ends shift, the other two stay.
    expect(out).toEqual([[0, 0], [13, 0], [13, 10], [0, 10]]);
  });

  it('wraps an edge drag across the closing seam', () => {
    const out = editedOutline(SQUARE, { kind: 'moveEdge', index: 3, dx: -2, dy: 0 })!;
    // Edge 3 is [0,10] → [0,0], the ring's last edge.
    expect(out).toEqual([[-2, 0], [10, 0], [10, 10], [-2, 10]]);
  });

  it('deletes a vertex', () => {
    expect(editedOutline(SQUARE, { kind: 'delete', index: 2 })).toEqual([
      [0, 0], [10, 0], [0, 10],
    ]);
  });

  // Below three corners it stops being a room at all.
  it('refuses to delete the third-to-last vertex', () => {
    const tri: Polygon = [[0, 0], [10, 0], [5, 8]];
    expect(editedOutline(tri, { kind: 'delete', index: 0 })).toBeNull();
  });

  it('refuses a move to a vertex that is not there', () => {
    expect(editedOutline(SQUARE, { kind: 'move', index: 9, x: 0, y: 0 })).toBeNull();
  });

  it('snaps to the grid when the grid says so', () => {
    useStore.setState((s) => {
      s.grid.snapEnabled = true;
      s.grid.snapDivision = 2;
    });
    const out = editedOutline(SQUARE, { kind: 'move', index: 0, x: 3.3, y: 4.8 })!;
    expect(out[0]).toEqual([3.5, 5]);
  });
});

// ─── Curve-aware edits ──────────────────────────────────────────────────────
// Tangents must ride every splice and move, and an insert on a curved edge
// must not change the drawn curve.

/** Curve bulging edge 0 (from [0,0] to [10,0]) downward. */
const curved = (): { ring: Polygon; tangents: RingTangents } => ({
  ring: SQUARE.map(([x, y]): [number, number] => [x, y]),
  tangents: [{ tout: [3, -5] }, { tin: [7, -5] }, null, null],
});

function area(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a / 2);
}

describe('editedCurvedRing', () => {
  it('moves a vertex and carries its tangents by the same delta', () => {
    const { ring, tangents } = curved();
    const out = editedCurvedRing(ring, tangents, { kind: 'move', index: 0, x: 2, y: 3 })!;
    expect(out.ring[0]).toEqual([2, 3]);
    expect(out.tangents[0]?.tout).toEqual([5, -2]);
    // The far end of the curve did not move.
    expect(out.tangents[1]?.tin).toEqual([7, -5]);
  });

  it('moves an edge and carries both anchors’ tangents', () => {
    const { ring, tangents } = curved();
    const out = editedCurvedRing(ring, tangents, { kind: 'moveEdge', index: 0, dx: 1, dy: 1 })!;
    expect(out.ring[0]).toEqual([1, 1]);
    expect(out.ring[1]).toEqual([11, 1]);
    expect(out.tangents[0]?.tout).toEqual([4, -4]);
    expect(out.tangents[1]?.tin).toEqual([8, -4]);
  });

  it('splices a straight insert with a null tangent slot', () => {
    const out = editedCurvedRing(SQUARE, undefined, { kind: 'insert', index: 1, x: 10, y: 5 })!;
    expect(out.ring).toHaveLength(5);
    expect(out.ring[2]).toEqual([10, 5]);
    expect(out.tangents).toHaveLength(5);
    expect(out.tangents[2]).toBeNull();
  });

  it('inserts on a curved edge without changing the drawn curve', () => {
    const { ring, tangents } = curved();
    const [c1, c2] = edgeControls(ring[0], ring[1], tangents[0], tangents[1]);
    const mid = pointOnCubic(ring[0], c1, c2, ring[1], 0.5);
    const out = editedCurvedRing(ring, tangents, {
      kind: 'insert',
      index: 0,
      x: mid[0],
      y: mid[1],
    })!;
    expect(out.ring).toHaveLength(5);
    // The new anchor lands ON the curve…
    expect(out.ring[1][0]).toBeCloseTo(mid[0], 6);
    expect(out.ring[1][1]).toBeCloseTo(mid[1], 6);
    // …and the flattened geometry is preserved.
    const before = area(flattenRing(ring, tangents));
    const after = area(flattenRing(out.ring, out.tangents));
    expect(after).toBeCloseTo(before, 2);
  });

  it('deletes a vertex together with its tangents', () => {
    const { ring, tangents } = curved();
    const out = editedCurvedRing(ring, tangents, { kind: 'delete', index: 0 })!;
    expect(out.ring).toHaveLength(3);
    expect(out.ring[0]).toEqual([10, 0]);
    expect(out.tangents[0]?.tin).toEqual([7, -5]);
    expect(out.tangents).toHaveLength(3);
  });

  it('toggleSmooth creates a mirrored pair along the neighbour chord, then clears it', () => {
    const out = editedCurvedRing(SQUARE, undefined, { kind: 'toggleSmooth', index: 1 })!;
    const vt = out.tangents[1]!;
    const p = SQUARE[1];
    expect(vt.tin).toBeDefined();
    expect(vt.tout).toBeDefined();
    // Collinear through the anchor: tin + tout = 2p for equal edge lengths.
    expect(vt.tin![0] + vt.tout![0]).toBeCloseTo(2 * p[0], 9);
    expect(vt.tin![1] + vt.tout![1]).toBeCloseTo(2 * p[1], 9);
    const back = editedCurvedRing(out.ring, out.tangents, { kind: 'toggleSmooth', index: 1 })!;
    expect(back.tangents[1]).toBeNull();
  });
});
