// W3 — the explored tier stopped being a staircase, and stayed free per frame.
//
// Three properties, and each is written so the *rects* would answer differently: the paint
// carries a ramp where the bits carry a step, the ring it is cut from runs off the axes where
// a row run cannot, and a one-cell-thin run survives a blur wide enough to round a step. The
// fourth row is the discipline the fix is only allowed to cost once — a record that has not
// changed is painted once however many times the mask around it is rebuilt.

import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { regionOf, setCells, type Cell, type RegionMask } from '@dnd/mechanics/fog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MASK_LEVEL, MASK_SCALE, maskField, maskRings } from './memoryMask';
import { visionRegion } from './fog';

vi.mock('./memoryMask', async () => {
  const actual = await vi.importActual<typeof import('./memoryMask')>('./memoryMask');
  return { ...actual, maskField: vi.fn(actual.maskField) };
});

/** How many times the field has been painted since the counter was last read. */
const paints = (): number => vi.mocked(maskField).mock.calls.length;

const FRAME = { minX: 0, minY: 0, maxX: 12, maxY: 12 };
const record = (cells: Cell[]): RegionMask => setCells(regionOf(FRAME)!, cells);

/** The field's value at a world point, by nearest sub-sample. */
const alphaAt = (field: NonNullable<ReturnType<typeof maskField>>, x: number, y: number): number => {
  const c = Math.round((x - field.originX) / field.step);
  const r = Math.round((y - field.originY) / field.step);
  return field.alpha[r * field.cols + c];
};

beforeEach(() => {
  vi.mocked(maskField).mockClear();
});

describe('maskField — the paint under the tier', () => {
  it('ramps across a boundary the bits step across', () => {
    // Everything west of x = 6 swept, everything east of it not: one straight edge.
    const cells: Cell[] = [];
    for (let row = 2; row < 10; row++) for (let col = 0; col < 6; col++) cells.push([col, row]);
    const field = maskField(record(cells))!;
    expect(field).not.toBeNull();

    // Sampled across that edge, half a cell either side of it.
    const ramp = [5.4, 5.6, 5.8, 6.0, 6.2, 6.4].map((x) => alphaAt(field, x, 6));
    // Monotone down, and not a step: a rect's own edge is 1 then 0 with nothing between.
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeLessThanOrEqual(ramp[i - 1]);
    expect(ramp.filter((v) => v > 0.02 && v < 0.98).length).toBeGreaterThanOrEqual(3);
    // …and the ramp is still centred on the boundary, so the tier does not move: the cut
    // level is crossed inside the quarter-cell either side of it.
    expect(alphaAt(field, 5.9, 6)).toBeGreaterThan(MASK_LEVEL);
    expect(alphaAt(field, 6.1, 6)).toBeLessThan(MASK_LEVEL);
    // Well inside is untouched; well outside is nothing.
    expect(alphaAt(field, 3, 6)).toBe(1);
    expect(alphaAt(field, 9, 6)).toBe(0);
  });

  it('is nothing to paint without a record', () => {
    expect(maskField(undefined)).toBeNull();
  });
});

describe('maskRings — the outline the tier is cut from', () => {
  /** A diagonal boundary: the case `regionRects` hands back as one-cell steps. */
  const diagonal = (): RegionMask => {
    const cells: Cell[] = [];
    for (let row = 0; row < 10; row++) for (let col = 0; col <= row; col++) cells.push([col, row]);
    return record(cells);
  };

  const segments = (ring: Polygon): [number, number][] =>
    ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length];
      return [q[0] - p[0], q[1] - p[1]] as [number, number];
    });

  it('runs off the axes where a row run cannot', () => {
    const rings = maskRings(maskField(diagonal())!);
    expect(rings.length).toBeGreaterThan(0);
    const all = rings.flatMap(segments);
    const eps = 1e-6;
    const oblique = all.filter(([dx, dy]) => Math.abs(dx) > eps && Math.abs(dy) > eps);
    // Every segment of a merged row run is axis-aligned; most of these are not.
    expect(oblique.length / all.length).toBeGreaterThan(0.3);
  });

  it('winds an outline positive, as the row runs it replaces do', () => {
    const rings = maskRings(maskField(record([[4, 4]]))!);
    const area = (ring: Polygon): number =>
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return sum + (p[0] * q[1] - q[0] * p[1]);
      }, 0) / 2;
    expect(rings).toHaveLength(1);
    expect(area(rings[0])).toBeGreaterThan(0);
  });

  it('keeps a one-cell-thin run — the blur rounds a step, it does not erase a corridor', () => {
    // The trap the supersample exists for: a normalised blur a cell wide drops a cell-thin run
    // under the cut level, and the corridor the party swept vanishes out of their memory.
    const rings = maskRings(
      maskField(
        record([
          [4, 5],
          [5, 5],
          [6, 5],
        ]),
      )!,
    );
    expect(rings).toHaveLength(1);
    expect(pointInPolygon([5.5, 5.5], rings[0])).toBe(true);
    // …and the cell below it, which nobody swept, is still not in the party's memory.
    expect(pointInPolygon([5.5, 6.5], rings[0])).toBe(false);
    // Three sub-samples a cell is what buys that margin; at two, a lone cell disappears.
    expect(MASK_SCALE).toBeGreaterThanOrEqual(3);
    // …and a lone cell is the sharpest form of it: one square the party glimpsed and nothing
    // touching it, which the referee wrote and the mask may not quietly drop.
    const lone = maskRings(maskField(record([[4, 4]]))!);
    expect(lone).toHaveLength(1);
    expect(pointInPolygon([4.5, 4.5], lone[0])).toBe(true);
  });
});

describe('the repaint trigger — once per region delta, never per frame', () => {
  const PAD = 0.8;
  const FEATHER = 0.4;
  const ROOM: Polygon = [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ];
  /** A fresh sweep every call, as a dragged token hands over. */
  const looking = (x: number): Polygon => [
    [x, 0],
    [x + 1, 0],
    [x + 1, 1],
    [x, 1],
  ];

  it('paints once however many rebuilds the record survives', () => {
    const swept = record([
      [4, 5],
      [5, 5],
    ]);
    for (let frame = 0; frame < 30; frame++) {
      visionRegion([looking(frame / 30)], swept, [], [ROOM], PAD, FEATHER);
    }
    expect(paints()).toBe(1);
  });

  it('repaints when the referee writes a cell, and not otherwise', () => {
    const swept = record([[4, 5]]);
    visionRegion([looking(0)], swept, [], [ROOM], PAD, FEATHER);
    expect(paints()).toBe(1);

    // A fog `state-update` that touched no cell at all — the memo is keyed on the bytes.
    visionRegion([looking(1)], { ...swept }, [], [ROOM], PAD, FEATHER);
    expect(paints()).toBe(1);

    // …and a real delta, which has to miss it.
    visionRegion([looking(2)], setCells(swept, [[5, 5]]), [], [ROOM], PAD, FEATHER);
    expect(paints()).toBe(2);
  });

  it('counts the cells the record holds, not the ones the outline encloses', () => {
    const swept = record([
      [1, 1],
      [2, 1],
      [7, 7],
    ]);
    expect(visionRegion([], swept, [], [ROOM], PAD, FEATHER).cells).toBe(3);
  });
});
