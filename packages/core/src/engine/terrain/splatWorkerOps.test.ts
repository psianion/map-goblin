import { describe, expect, it } from 'vitest';
import { SPLAT_SIZE, TERRAIN_EXTENT_HALF } from './terrainShared';
import { createSplatState, flush, patch, reset, seed } from './splatWorkerOps';

const px = (v: number) => {
  const p = new Uint8Array(4);
  p[0] = v;
  p[3] = 255;
  return p;
};

describe('splat worker ops', () => {
  it('never allocates for a map that never paints', () => {
    const state = createSplatState();
    expect(flush(state)).toEqual({ bounds: null, dirtyIndices: [] });
    expect(state.splats).toEqual([null, null]);
  });

  it('patch marks dirty and flush reports bounds then clears dirty', () => {
    const state = createSplatState();
    patch(state, 0, { x: 0, y: 0, width: 1, height: 1 }, px(255));
    const first = flush(state);
    expect(first.dirtyIndices).toEqual([0]);
    expect(first.bounds?.minX).toBeCloseTo(-TERRAIN_EXTENT_HALF);
    // Nothing changed since — nothing to encode, bounds still reported.
    const second = flush(state);
    expect(second.dirtyIndices).toEqual([]);
    expect(second.bounds).toEqual(first.bounds);
  });

  it('an erase patch shrinks bounds back to null', () => {
    const state = createSplatState();
    patch(state, 1, { x: 4, y: 4, width: 1, height: 1 }, px(200));
    expect(flush(state).bounds).not.toBeNull();
    patch(state, 1, { x: 4, y: 4, width: 1, height: 1 }, px(0));
    const after = flush(state);
    expect(after.bounds).toBeNull();
    expect(after.dirtyIndices).toEqual([1]);
  });

  it('seed replaces content without marking dirty; null seed clears', () => {
    const state = createSplatState();
    const full = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
    full[0] = 255;
    seed(state, 0, full);
    expect(flush(state)).toMatchObject({ dirtyIndices: [] });
    expect(flush(state).bounds).not.toBeNull();
    seed(state, 0, null);
    expect(flush(state).bounds).toBeNull();
  });

  it('reset drops both maps', () => {
    const state = createSplatState();
    patch(state, 0, { x: 0, y: 0, width: 1, height: 1 }, px(9));
    reset(state);
    expect(state.splats).toEqual([null, null]);
    expect(flush(state)).toEqual({ bounds: null, dirtyIndices: [] });
  });
});
