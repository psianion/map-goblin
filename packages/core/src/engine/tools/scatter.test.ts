import { describe, it, expect, beforeEach } from 'vitest';
import { beginStroke, scatterDab, MAX_DAB, OVERLAP_SHRINK, type Placement, type ScatterCtx } from './scatter';
import { obbOverlap, shrinkObb, obbCorners, type Obb } from './propPlacement';
import { useStore } from '../../store/store';
import type { AssetChild, DungeonLayer, ScatterBrushSettings } from '../../store/types';
import type { Room } from '../../shared/types';
import { roomIndexOf } from '../../shared/roomIndex';
import { mulberry32 } from '../../geometry/seededRng';

function baseLayer(over: Partial<DungeonLayer> = {}): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return { ...l, children: [], rooms: [], mergedFloor: null, ...over };
}

function settings(over: Partial<ScatterBrushSettings> = {}): ScatterBrushSettings {
  return {
    ...useStore.getState().tools.settings.scatterBrush,
    assetIds: ['a'],
    stampMode: false,
    brushRadius: 2,
    density: 1,
    minSpacing: 0.3,
    rotationRange: [0, Math.PI * 2],
    scaleRange: [1, 1],
    tints: [],
    randomVariant: false,
    avoidOverlap: false,
    stayOnFloor: false,
    seed: 7,
    ...over,
  };
}

function prop(id: string, x: number, y: number, size = 0.2): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'a',
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: size,
    height: size,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

/** A stroke whose art sizes and families come from the test, not a catalogue. */
function stroke(
  layer: DungeonLayer,
  s: ScatterBrushSettings,
  strokeNo = 1,
  size = 0.2,
  families: Record<string, string[]> = {},
): ScatterCtx {
  const ctx = beginStroke(layer, s, strokeNo);
  ctx.sizeOf = () => ({ w: size, h: size });
  ctx.familyOf = (id) => families[id] ?? [id];
  return ctx;
}

const obbOf = (p: Placement): Obb => ({
  cx: p.position.x,
  cy: p.position.y,
  hw: p.width / 2,
  hh: p.height / 2,
  rot: p.rotation,
});

beforeEach(() => {
  useStore.getState().resetToDefault();
});

describe('how many a dab places', () => {
  it('density × brush area, rounded', () => {
    const got = scatterDab(stroke(baseLayer(), settings()), { x: 0, y: 0 }, 0);
    expect(got).toHaveLength(Math.round(Math.PI * 4));
  });

  it('less the props already standing in the circle', () => {
    const layer = baseLayer({ children: [prop('p1', 0.5, 0), prop('p2', -1, 0.5), prop('p3', 0, 1.5), prop('far', 9, 9)] });
    const got = scatterDab(stroke(layer, settings()), { x: 0, y: 0 }, 0);
    expect(got).toHaveLength(Math.round(Math.PI * 4) - 3);
  });

  it('a second dab in the same place sees the first one', () => {
    const ctx = stroke(baseLayer(), settings());
    expect(scatterDab(ctx, { x: 0, y: 0 }, 0).length).toBeGreaterThan(0);
    expect(scatterDab(ctx, { x: 0, y: 0 }, 1)).toHaveLength(0);
  });

  it('never more than MAX_DAB', () => {
    const got = scatterDab(stroke(baseLayer(), settings({ brushRadius: 10, density: 1.5, minSpacing: 0.2 })), { x: 0, y: 0 }, 0);
    expect(MAX_DAB).toBe(60);
    expect(got).toHaveLength(MAX_DAB);
  });

  it('places the size it rolled once: width carries the scale, nothing is squared', () => {
    const got = scatterDab(stroke(baseLayer(), settings({ scaleRange: [2, 3] }), 1, 0.5), { x: 0, y: 0 }, 0);
    for (const p of got) {
      expect(p.scale).toBeGreaterThanOrEqual(2);
      expect(p.scale).toBeLessThanOrEqual(3);
      expect(p.width).toBeCloseTo(0.5 * p.scale);
    }
  });
});

describe('seeding', () => {
  it('the same seed, stroke and dab replay exactly; any of them changed gives another stroke', () => {
    const run = (seed: number, strokeNo: number, dabNo: number) =>
      scatterDab(stroke(baseLayer(), settings({ seed }), strokeNo), { x: 0, y: 0 }, dabNo);
    expect(run(7, 1, 0)).toEqual(run(7, 1, 0));
    expect(run(7, 2, 0)).not.toEqual(run(7, 1, 0));
    expect(run(8, 1, 0)).not.toEqual(run(7, 1, 0));
    expect(run(7, 1, 1)).not.toEqual(run(7, 1, 0));
  });
});

describe('avoid overlaps', () => {
  it('no two shrunk footprints overlap, the layer’s own props included', () => {
    const existing = [prop('e1', 1, 1, 1), prop('e2', -2, 0, 1.5)];
    const layer = baseLayer({ children: existing });
    const ctx = stroke(layer, settings({ avoidOverlap: true, brushRadius: 4, density: 1.5, minSpacing: 0.2, scaleRange: [0.8, 1.4] }), 1, 1);
    const placed: Placement[] = [];
    for (let i = 0; i < 12; i++) placed.push(...scatterDab(ctx, { x: (i % 4) - 1.5, y: Math.floor(i / 4) - 1 }, i));
    expect(placed.length).toBeGreaterThan(5);
    expect(ctx.stats.skippedOverlap).toBeGreaterThan(0);

    const boxes = [
      ...existing.map((c) => ({ cx: c.position.x, cy: c.position.y, hw: c.width / 2, hh: c.height / 2, rot: 0 })),
      ...placed.map(obbOf),
    ].map((o) => shrinkObb(o, OVERLAP_SHRINK));
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) if (obbOverlap(boxes[i], boxes[j])) overlaps++;
    }
    expect(overlaps).toBe(0);
  });
});

describe('stay on floors', () => {
  const room = (id: string, x0: number, x1: number): Room => ({
    id,
    name: id,
    anchor: [(x0 + x1) / 2, 4],
    face: [[x0, 0], [x1, 0], [x1, 8], [x0, 8]],
  });

  it('nothing lands off the floor or across a wall, over 1 000 candidates', () => {
    const layer = baseLayer({ rooms: [room('hall', 0, 8), room('store', 8, 14)] });
    const index = roomIndexOf(layer.rooms);
    const rng = mulberry32(3);
    let tried = 0;
    let placed = 0;
    let offFloor = 0;
    for (let n = 1; tried < 1000; n++) {
      const ctx = stroke(layer, settings({ stayOnFloor: true, brushRadius: 3, minSpacing: 0.4, scaleRange: [1, 2] }), n, 0.6);
      // Along the wall between the rooms and over the outer edge.
      const got = scatterDab(ctx, { x: 6 + rng() * 4, y: rng() * 10 - 1 }, 0);
      tried += ctx.stats.placed + ctx.stats.skippedFloor;
      for (const p of got) {
        placed++;
        const o = obbOf(p);
        const r = index.roomAt(o.cx, o.cy);
        if (!r || obbCorners(o).some((c) => index.roomAt(c.x, c.y) !== r)) offFloor++;
      }
    }
    expect(placed).toBeGreaterThan(50);
    expect(offFloor).toBe(0);
  });

  it('a layer with no floor runs the stroke without the test and says so', () => {
    const ctx = stroke(baseLayer(), settings({ stayOnFloor: true }));
    expect(ctx.stats.noFloor).toBe(true);
    expect(scatterDab(ctx, { x: 0, y: 0 }, 0).length).toBeGreaterThan(0);
  });
});

describe('pool, tints and variants', () => {
  it('spreads over the pool and the tints', () => {
    const s = settings({ assetIds: ['a', 'b', 'c'], tints: ['#ff0000', '#00ff00'], brushRadius: 6, minSpacing: 0.2 });
    const got: Placement[] = [];
    for (let n = 1; n <= 5; n++) got.push(...scatterDab(stroke(baseLayer(), s, n), { x: 0, y: 0 }, 0));
    expect(got.length).toBeGreaterThan(200);
    const share = (pick: (p: Placement) => string, v: string) => got.filter((p) => pick(p) === v).length / got.length;
    for (const id of ['a', 'b', 'c']) expect(share((p) => p.assetId, id)).toBeGreaterThan(0.2);
    for (const t of ['#ff0000', '#00ff00']) expect(share((p) => p.tint, t)).toBeGreaterThan(0.35);
  });

  it('no tints means untinted', () => {
    const got = scatterDab(stroke(baseLayer(), settings()), { x: 0, y: 0 }, 0);
    expect(new Set(got.map((p) => p.tint))).toEqual(new Set(['#ffffff']));
  });

  it('random variant picks within each pooled prop’s family', () => {
    const families = { a: ['a', 'a2', 'a3'], b: ['b'] };
    const s = settings({ assetIds: ['a', 'b'], randomVariant: true, brushRadius: 5 });
    const got = scatterDab(stroke(baseLayer(), s, 1, 0.2, families), { x: 0, y: 0 }, 0);
    const ids = new Set(got.map((p) => p.assetId));
    for (const id of ids) expect(['a', 'a2', 'a3', 'b']).toContain(id);
    expect(ids.has('a2') || ids.has('a3')).toBe(true);
  });
});

describe('speed', () => {
  it('a dab at density 1 and radius 5 among 133 props stays well inside a frame', () => {
    const rng = mulberry32(11);
    const children = Array.from({ length: 133 }, (_, i) => prop(`p${i}`, rng() * 40, rng() * 30, 0.5 + rng()));
    const layer = baseLayer({
      children,
      mergedFloor: [[[0, 0], [40, 0], [40, 30], [0, 30]]],
    });
    const s = settings({ density: 1, brushRadius: 5, minSpacing: 0.5, avoidOverlap: true, stayOnFloor: true, scaleRange: [0.8, 1.2] });
    // Warm up, then time a run of dabs on fresh strokes.
    scatterDab(stroke(layer, s, 0, 0.6), { x: 20, y: 15 }, 0);
    const runs = 20;
    const t0 = performance.now();
    for (let n = 1; n <= runs; n++) scatterDab(stroke(layer, s, n, 0.6), { x: 10 + n, y: 15 }, 0);
    const perDab = (performance.now() - t0) / runs;
    // §13 asks for 4 ms; the bound here leaves room for a slow CI box.
    expect(perDab).toBeLessThan(20);
  });
});
