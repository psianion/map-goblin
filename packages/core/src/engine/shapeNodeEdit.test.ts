import { describe, it, expect, beforeEach } from 'vitest';
import { editedOutline } from './shapeNodeEdit';
import { useStore } from '../store/store';
import type { Polygon } from '../types/geometry';

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
