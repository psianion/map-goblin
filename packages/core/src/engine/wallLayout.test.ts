import { describe, it, expect } from 'vitest';
import {
  layoutWall,
  applyWallEdits,
  mergeNodeEdit,
  mergeSpanEdit,
  pieceWorldLength,
  nodeSpriteScale,
  type WallPieceSpec,
} from './wallLayout';

// Mirrors the real stone-slate set: lengths and band thicknesses are the
// contentRect values from textureManifest, rocks are the Connector_* pieces.
const STONE: WallPieceSpec[] = [
  { id: 'straight-a-3x1', role: 'straight', lengthPx: 600, thicknessPx: 61 },
  { id: 'straight-b-2x1', role: 'straight', lengthPx: 400, thicknessPx: 61 },
  { id: 'straight-c-1x1', role: 'straight', lengthPx: 200, thicknessPx: 57 },
  { id: 'straight-d-1x1', role: 'straight', lengthPx: 100, thicknessPx: 53 },
  { id: 'rock-a', role: 'rock', lengthPx: 70, thicknessPx: 60 },
  { id: 'rock-b', role: 'rock', lengthPx: 64, thicknessPx: 60 },
  { id: 'rock-c', role: 'rock', lengthPx: 58, thicknessPx: 60 },
  { id: 'rock-d', role: 'rock', lengthPx: 72, thicknessPx: 60 },
  { id: 'corner-a-1x1', role: 'corner', lengthPx: 200, thicknessPx: 61, authoredTurn: Math.PI / 2 },
  { id: 'ending-a-1x1', role: 'ending', lengthPx: 200, thicknessPx: 61 },
];

const WIDTH = 0.5;

function ngon(cx: number, cy: number, r: number, sides: number, rot = 0): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / sides;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

const run = (pts: [number, number][], closed: boolean) =>
  layoutWall(pts, closed, STONE, { wallWidth: WIDTH, seed: 7 });

describe('layoutWall — junctions', () => {
  it('uses authored elbows at 90° corners', () => {
    const nodes = run(ngon(0, 0, 6, 4, Math.PI / 4), true);
    const corners = nodes.filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.pieceId === 'corner-a-1x1')).toBe(true);
    expect(nodes.some((n) => n.kind === 'fan')).toBe(false);
  });

  // An elbow rotated to the incoming edge angle looks right on two corners of a
  // square and wrong on the other two — the correct arm depends on the turn's
  // sign. Both arms must lie along the actual walls, at every corner.
  it('rotates authored elbows so both arms lie along the walls', () => {
    const pts = ngon(0, 0, 6, 4, Math.PI / 4);
    const corners = run(pts, true).filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(4);

    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const sameDir = (a: number, b: number) => Math.abs(wrap(a - b)) < 1e-6;
    const dirTo = (from: [number, number], to: [number, number]) =>
      Math.atan2(to[1] - from[1], to[0] - from[0]);

    for (const c of corners) {
      const vi = pts.findIndex((p) => Math.hypot(p[0] - c.x, p[1] - c.y) < 1e-6);
      expect(vi).toBeGreaterThanOrEqual(0);
      const back = dirTo(pts[vi], pts[(vi - 1 + pts.length) % pts.length]);
      const fwd = dirTo(pts[vi], pts[(vi + 1) % pts.length]);
      const arms = [c.angle, c.angle + Math.PI / 2];
      const aligned =
        (sameDir(arms[0], back) && sameDir(arms[1], fwd)) ||
        (sameDir(arms[0], fwd) && sameDir(arms[1], back));
      expect(aligned).toBe(true);
    }
  });

  // The whole point of #19: every Corner_* piece is a 90° elbow, so a 120°
  // hexagon vertex must be carried by a fan, never by an elbow.
  it('fans hexagon vertices (120°) instead of forcing an elbow', () => {
    const nodes = run(ngon(0, 0, 6, 6), true);
    expect(nodes.filter((n) => n.kind === 'corner')).toHaveLength(0);
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans.length).toBeGreaterThanOrEqual(6);
    // Fan material comes from the same set's small pieces.
    expect(fans.every((f) => f.pieceId.startsWith('rock-'))).toBe(true);
  });

  it('fans octagon vertices (135°) instead of forcing an elbow', () => {
    const nodes = run(ngon(0, 0, 6, 8, Math.PI / 8), true);
    expect(nodes.filter((n) => n.kind === 'corner')).toHaveLength(0);
    expect(nodes.filter((n) => n.kind === 'fan').length).toBeGreaterThanOrEqual(8);
  });

  it('rotates every fan piece to its own angle', () => {
    const nodes = run(ngon(0, 0, 6, 6), true);
    const angles = new Set(nodes.filter((n) => n.kind === 'fan').map((n) => n.angle.toFixed(4)));
    // A rigid elbow would give one angle per vertex; a fan turns through it.
    expect(angles.size).toBeGreaterThan(6);
  });

  // Fan pieces are fitted by arc length. Spacing them evenly by turn angle
  // instead opens a hole whenever the rocks picked are shorter than the gap.
  it('fills a turn with no gap between fan pieces', () => {
    const nodes = layoutWall([[0, 0], [10, 0], [16, 6]], false, STONE, {
      wallWidth: WIDTH,
      seed: 11,
    });
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans.length).toBeGreaterThan(1);
    for (let i = 1; i < fans.length; i++) {
      const a = STONE.find((p) => p.id === fans[i - 1].pieceId)!;
      const b = STONE.find((p) => p.id === fans[i].pieceId)!;
      const halfSum =
        (pieceWorldLength(a, WIDTH) * fans[i - 1].scale) / 2 +
        (pieceWorldLength(b, WIDTH) * fans[i].scale) / 2;
      // Centres sit on an arc, so their chord can never exceed the arc spacing
      // unless a gap was left.
      const dist = Math.hypot(fans[i].x - fans[i - 1].x, fans[i].y - fans[i - 1].y);
      expect(dist).toBeLessThanOrEqual(halfSum + 1e-9);
    }
  });

  it('leaves a near-straight vertex alone', () => {
    const nodes = layoutWall(
      [[0, 0], [10, 0], [20, 0.2]], // ~1.1° kink
      false,
      STONE,
      { wallWidth: WIDTH, seed: 7 },
    );
    expect(nodes.some((n) => n.kind === 'fan' || n.kind === 'corner')).toBe(false);
  });
});

describe('layoutWall — straight fill', () => {
  it('covers the run exactly when pieces are packed edge to edge', () => {
    const L = 17.3;
    const nodes = layoutWall([[0, 0], [L, 0]], false, STONE, {
      wallWidth: WIDTH,
      seed: 3,
      overlap: 0,
    });
    const covered = nodes
      .filter((n) => n.kind === 'straight')
      .reduce((s, n) => {
        const p = STONE.find((q) => q.id === n.pieceId)!;
        return s + pieceWorldLength(p, WIDTH) * n.scale;
      }, 0);
    expect(covered).toBeCloseTo(L, 6);
  });

  it('leaves no gap between consecutive straight pieces', () => {
    const nodes = layoutWall([[0, 0], [23, 0]], false, STONE, {
      wallWidth: WIDTH,
      seed: 3,
      overlap: 0,
    }).filter((n) => n.kind === 'straight');
    for (let i = 1; i < nodes.length; i++) {
      const prev = STONE.find((q) => q.id === nodes[i - 1].pieceId)!;
      const curr = STONE.find((q) => q.id === nodes[i].pieceId)!;
      const halfSpan =
        (pieceWorldLength(prev, WIDTH) * nodes[i - 1].scale) / 2 +
        (pieceWorldLength(curr, WIDTH) * nodes[i].scale) / 2;
      expect(nodes[i].x - nodes[i - 1].x).toBeCloseTo(halfSpan, 6);
    }
  });

  // Stones are irregular blobs — edge-to-edge bounding boxes still show seams,
  // so the default packs them tighter than their own width.
  it('overlap tightens spacing below edge-to-edge', () => {
    const pts: [number, number][] = [[0, 0], [23, 0]];
    const spacing = (overlap: number) => {
      const ns = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 3, overlap })
        .filter((n) => n.kind === 'straight');
      return ns[1].x - ns[0].x;
    };
    expect(spacing(0.12)).toBeLessThan(spacing(0));
    // Still covers the run: tighter spacing means more pieces, never a gap.
    const tight = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 3, overlap: 0.12 })
      .filter((n) => n.kind === 'straight');
    const loose = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 3, overlap: 0 })
      .filter((n) => n.kind === 'straight');
    expect(tight.length).toBeGreaterThanOrEqual(loose.length);
  });

  it('distributes mixed piece sizes largest-first', () => {
    const nodes = layoutWall([[0, 0], [40, 0]], false, STONE, { wallWidth: WIDTH, seed: 3 });
    const used = new Set(nodes.filter((n) => n.kind === 'straight').map((n) => n.pieceId));
    expect(used.has('straight-a-3x1')).toBe(true);
    expect(used.size).toBeGreaterThan(1);
  });

  it('fits a run shorter than the smallest piece rather than gapping', () => {
    const tiny = pieceWorldLength(STONE[3], WIDTH) * 0.3;
    const nodes = layoutWall([[0, 0], [tiny, 0]], false, STONE, { wallWidth: WIDTH, seed: 3 });
    const straights = nodes.filter((n) => n.kind === 'straight');
    expect(straights).toHaveLength(1);
    expect(straights[0].scale).toBeLessThan(1);
  });
});

describe('applyWallEdits', () => {
  const base = () =>
    layoutWall([[0, 0], [20, 0]], false, STONE, { wallWidth: WIDTH, seed: 3 });

  it('passes an unedited wall straight through', () => {
    const nodes = base();
    expect(applyWallEdits(nodes, undefined)).toBe(nodes);
    expect(applyWallEdits(nodes, {})).toBe(nodes);
    expect(applyWallEdits(nodes, { nodeEdits: [] })).toBe(nodes);
  });

  it('swaps, rotates and rescales the node nearest t', () => {
    const nodes = base();
    const target = nodes[3];
    const out = applyWallEdits(nodes, {
      nodeEdits: [{ t: target.t, pieceId: 'rock-a', rotate: 0.4, scale: 2 }],
    });
    const edited = out.find((n) => Math.abs(n.t - target.t) < 1e-9)!;
    expect(edited.pieceId).toBe('rock-a');
    expect(edited.angle).toBeCloseTo(target.angle + 0.4, 9);
    expect(edited.sizeScale).toBeCloseTo(target.sizeScale * 2, 9);
    // The run's auto-fit stretch is untouched — a resize is not a re-fit.
    expect(edited.scale).toBeCloseTo(target.scale, 9);
  });

  it('resizes about the node, not off one end', () => {
    const nodes = base();
    const target = nodes[3];
    const out = applyWallEdits(nodes, { nodeEdits: [{ t: target.t, scale: 2 }] });
    const edited = out.find((n) => Math.abs(n.t - target.t) < 1e-9)!;
    // The anchored point stays put, so the stone grows both ways about itself.
    expect(edited.x).toBeCloseTo(target.x, 9);
    expect(edited.y).toBeCloseTo(target.y, 9);
  });

  it('gives an inserted node its scale as a resize, not a run fit', () => {
    const nodes = base();
    const t = (nodes[2].t + nodes[3].t) / 2;
    const out = applyWallEdits(nodes, { nodeInserts: [{ t, pieceId: 'rock-d', scale: 1.5 }] });
    const added = out.find((n) => n.kind === 'inserted')!;
    expect(added.sizeScale).toBeCloseTo(1.5, 9);
    expect(added.scale).toBe(1);
  });
  it('nudges a node by a dragged offset', () => {
    const nodes = base();
    const out = applyWallEdits(nodes, { nodeEdits: [{ t: nodes[2].t, dx: 0.3, dy: -0.7 }] });
    expect(out[2].x).toBeCloseTo(nodes[2].x + 0.3, 9);
    expect(out[2].y).toBeCloseTo(nodes[2].y - 0.7, 9);
    expect(out[3].x).toBeCloseTo(nodes[3].x, 9);
  });

  it('removes a node', () => {
    const nodes = base();
    const out = applyWallEdits(nodes, { nodeEdits: [{ t: nodes[2].t, removed: true }] });
    expect(out).toHaveLength(nodes.length - 1);
    expect(out.some((n) => n.t === nodes[2].t)).toBe(false);
  });

  it('does not mutate the input nodes', () => {
    const nodes = base();
    const before = JSON.stringify(nodes);
    applyWallEdits(nodes, {
      nodeEdits: [{ t: nodes[2].t, pieceId: 'rock-a', rotate: 1 }],
      spanEdits: [{ t: nodes[1].t, gap: 0.5 }],
    });
    expect(JSON.stringify(nodes)).toBe(before);
  });

  // Edits anchor on t, never an index — a moved vertex relays the whole run and
  // an index key would silently reattach to a different stone.
  it('lapses an edit whose anchor no longer has a node', () => {
    const nodes = base();
    const out = applyWallEdits(nodes, { nodeEdits: [{ t: 0.5, removed: true }] }, 0.0001);
    expect(out).toHaveLength(nodes.length);
  });

  it('reattaches an edit to the nearest node within tolerance', () => {
    const nodes = base();
    const out = applyWallEdits(
      nodes,
      { nodeEdits: [{ t: nodes[3].t + 0.005, pieceId: 'rock-b' }] },
      0.02,
    );
    expect(out.filter((n) => n.pieceId === 'rock-b').length).toBeGreaterThan(0);
  });

  it('widens the seam between two nodes without cascading', () => {
    const nodes = base();
    const gap = 0.6;
    const out = applyWallEdits(nodes, { spanEdits: [{ t: nodes[2].t, gap }] });
    const before = Math.hypot(nodes[3].x - nodes[2].x, nodes[3].y - nodes[2].y);
    const after = Math.hypot(out[3].x - out[2].x, out[3].y - out[2].y);
    expect(after - before).toBeCloseTo(gap, 6);
    // Untouched neighbours stay put — one drag must not shift the whole wall.
    expect(out[5].x).toBeCloseTo(nodes[5].x, 9);
  });

  it('inserts a node on the spine between its neighbours', () => {
    const nodes = base();
    const t = (nodes[2].t + nodes[3].t) / 2;
    const out = applyWallEdits(nodes, { nodeInserts: [{ t, pieceId: 'rock-d' }] });
    expect(out).toHaveLength(nodes.length + 1);
    const added = out.find((n) => n.kind === 'inserted')!;
    expect(added.x).toBeGreaterThan(nodes[2].x);
    expect(added.x).toBeLessThan(nodes[3].x);
    expect(out.map((n) => n.t)).toEqual([...out.map((n) => n.t)].sort((a, b) => a - b));
  });
});

describe('nodeSpriteScale', () => {
  const spec = STONE[0];
  const k = WIDTH / spec.thicknessPx;

  it('leaves an unedited node exactly as the band width dictates', () => {
    // Every auto node must render byte-identically to a layout with no resize
    // concept at all: spine axis carries the run fit, band axis carries only k.
    for (const node of run([[0, 0], [20, 0]], false)) {
      expect(node.sizeScale).toBe(1);
      const [sx, sy] = nodeSpriteScale(node, spec, WIDTH);
      expect(sx).toBeCloseTo(k * node.scale, 12);
      expect(sy).toBeCloseTo(k, 12);
    }
  });

  it('keeps the auto-fit stretch on the spine axis only', () => {
    const [sx, sy] = nodeSpriteScale({ scale: 0.8, sizeScale: 1 }, spec, WIDTH);
    expect(sx).toBeCloseTo(k * 0.8, 12);
    expect(sy).toBeCloseTo(k, 12);
  });

  it('resizes on both axes, keeping the stone proportional', () => {
    const [bx, by] = nodeSpriteScale({ scale: 1, sizeScale: 1 }, spec, WIDTH);
    const [sx, sy] = nodeSpriteScale({ scale: 1, sizeScale: 2 }, spec, WIDTH);
    expect(sx).toBeCloseTo(bx * 2, 12);
    expect(sy).toBeCloseTo(by * 2, 12);
    expect(sx / sy).toBeCloseTo(bx / by, 12);
  });

  it('resizes a run-fitted stone without distorting it further', () => {
    // A stone already squeezed by its run keeps that squeeze and gains the
    // resize on top, on both axes — not a second stretch along the spine.
    const [sx, sy] = nodeSpriteScale({ scale: 0.8, sizeScale: 1.5 }, spec, WIDTH);
    expect(sx).toBeCloseTo(k * 0.8 * 1.5, 12);
    expect(sy).toBeCloseTo(k * 1.5, 12);
  });
});

describe('mergeNodeEdit', () => {
  it('accumulates repeated drags and rotations', () => {
    let edits = mergeNodeEdit(undefined, { t: 0.4, dx: 0.2, dy: 0.1 });
    edits = mergeNodeEdit(edits, { t: 0.4, dx: 0.3, rotate: 0.5 });
    expect(edits).toHaveLength(1);
    expect(edits[0].dx).toBeCloseTo(0.5, 9);
    expect(edits[0].dy).toBeCloseTo(0.1, 9);
    expect(edits[0].rotate).toBeCloseTo(0.5, 9);
  });

  it('multiplies successive scales', () => {
    let edits = mergeNodeEdit(undefined, { t: 0.4, scale: 2 });
    edits = mergeNodeEdit(edits, { t: 0.4, scale: 1.5 });
    expect(edits[0].scale).toBeCloseTo(3, 9);
  });

  it('replaces rather than accumulates a swap', () => {
    let edits = mergeNodeEdit(undefined, { t: 0.4, pieceId: 'rock-a' });
    edits = mergeNodeEdit(edits, { t: 0.4, pieceId: 'rock-b' });
    expect(edits).toHaveLength(1);
    expect(edits[0].pieceId).toBe('rock-b');
  });

  it('keeps separate nodes separate', () => {
    let edits = mergeNodeEdit(undefined, { t: 0.1, dx: 1 });
    edits = mergeNodeEdit(edits, { t: 0.9, dx: 1 });
    expect(edits).toHaveLength(2);
  });

  // A node dragged back where it started should cost nothing in the save file.
  it('drops an edit that cancels out', () => {
    let edits = mergeNodeEdit(undefined, { t: 0.4, dx: 0.5 });
    expect(edits).toHaveLength(1);
    edits = mergeNodeEdit(edits, { t: 0.4, dx: -0.5 });
    expect(edits).toHaveLength(0);
  });

  it('does not mutate the list it was given', () => {
    const before = mergeNodeEdit(undefined, { t: 0.4, dx: 0.5 });
    const snapshot = JSON.stringify(before);
    mergeNodeEdit(before, { t: 0.4, dx: 0.5 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('mergeSpanEdit', () => {
  it('accumulates repeated seam adjustments', () => {
    let spans = mergeSpanEdit(undefined, { t: 0.3, gap: 0.05 });
    spans = mergeSpanEdit(spans, { t: 0.3, gap: 0.05 });
    expect(spans).toHaveLength(1);
    expect(spans[0].gap).toBeCloseTo(0.1, 9);
  });

  it('drops a seam returned to zero', () => {
    let spans = mergeSpanEdit(undefined, { t: 0.3, gap: 0.05 });
    spans = mergeSpanEdit(spans, { t: 0.3, gap: -0.05 });
    expect(spans).toHaveLength(0);
  });

  it('keeps separate seams separate', () => {
    let spans = mergeSpanEdit(undefined, { t: 0.2, gap: 0.05 });
    spans = mergeSpanEdit(spans, { t: 0.8, gap: 0.05 });
    expect(spans).toHaveLength(2);
  });

  it('does not mutate the list it was given', () => {
    const before = mergeSpanEdit(undefined, { t: 0.3, gap: 0.05 });
    const snapshot = JSON.stringify(before);
    mergeSpanEdit(before, { t: 0.3, gap: 0.05 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('layoutWall — ends and determinism', () => {
  // The doubled-end-cap bug: a chain drawn as N separate 2-point segments got
  // 2N caps, stacked in pairs at every joint. One chain is one wall, two caps.
  it('caps an open chain exactly twice regardless of vertex count', () => {
    const chain: [number, number][] = [[0, 0], [8, 0], [14, 5], [24, 5], [30, 12]];
    const nodes = layoutWall(chain, false, STONE, { wallWidth: WIDTH, seed: 5 });
    expect(nodes.filter((n) => n.kind === 'ending')).toHaveLength(2);
  });

  it('never caps a closed polygon', () => {
    const nodes = run(ngon(0, 0, 6, 6), true);
    expect(nodes.filter((n) => n.kind === 'ending')).toHaveLength(0);
  });

  it('is deterministic for the same seed', () => {
    const pts = ngon(0, 0, 6, 6);
    expect(run(pts, true)).toEqual(run(pts, true));
  });

  // Seeding varies fan material, not straight fill. Neither shipped set has two
  // straights of the same world length — Straight_C is 200px of content and
  // Straight_D is 100px — so largest-first has exactly one candidate per step
  // and nothing to choose between. Variety lives in the rocks.
  it('varies fan material with the seed', () => {
    const pts = ngon(0, 0, 6, 6);
    const a = layoutWall(pts, true, STONE, { wallWidth: WIDTH, seed: 1 });
    const b = layoutWall(pts, true, STONE, { wallWidth: WIDTH, seed: 999 });
    const fans = (ns: typeof a) => ns.filter((n) => n.kind === 'fan').map((n) => n.pieceId);
    expect(fans(a)).not.toEqual(fans(b));
  });

  it('gives identical straight fill for any seed in these sets', () => {
    const pts: [number, number][] = [[0, 0], [40, 0]];
    const ids = (s: number) =>
      layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: s })
        .filter((n) => n.kind === 'straight')
        .map((n) => n.pieceId);
    expect(ids(1)).toEqual(ids(999));
  });

  it('keeps t monotonic and in range — edits anchor on it', () => {
    const nodes = run(ngon(0, 0, 6, 6), true);
    expect(nodes.every((n) => n.t >= 0 && n.t <= 1)).toBe(true);
  });

  it('places three stones at an oblique vertex, none of them squashed', () => {
    // Acute vertex: the old arc fit compressed several pieces into a short
    // fillet and the stones came out visibly squashed.
    const nodes = layoutWall([[0, 0], [10, 0], [2, 5]], false, STONE, {
      wallWidth: WIDTH,
      seed: 4,
    });
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans).toHaveLength(3);
    expect(fans.every((f) => f.scale === 1)).toBe(true);
  });

  // The cover stone is rotated to the through-direction, so at a sharp turn it
  // shows the arms its narrow side. Offsetting the arms by half its LENGTH
  // regardless leaves a visible hole exactly where the turn is tightest.
  it.each([
    // All well clear of 90°, which takes an authored elbow instead of a fan.
    ['hairpin ~159°', [[0, 0], [10, 0], [2, 3]]],
    ['acute ~135°', [[0, 0], [10, 0], [2, 8]]],
    ['obtuse ~45°', [[0, 0], [10, 0], [16, 6]]],
    ['shallow ~21°', [[0, 0], [10, 0], [18, 3]]],
  ] as [string, [number, number][]][])(
    'tucks both arm stones against the cover stone (%s)',
    (_name, pts) => {
      const nodes = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 4 });
      const fans = nodes.filter((n) => n.kind === 'fan');
      expect(fans).toHaveLength(3);

      const [vx, vy] = pts[1];
      const cap = fans.find((f) => Math.hypot(f.x - vx, f.y - vy) < 1e-9)!;
      const capHalfLen =
        (pieceWorldLength(STONE.find((p) => p.id === cap.pieceId)!, WIDTH) * cap.scale) / 2;
      const capHalfThick = WIDTH / 2;

      for (const arm of fans.filter((f) => f !== cap)) {
        const dir = Math.atan2(arm.y - vy, arm.x - vx);
        const dist = Math.hypot(arm.x - vx, arm.y - vy);
        const armHalfLen =
          (pieceWorldLength(STONE.find((p) => p.id === arm.pieceId)!, WIDTH) * arm.scale) / 2;
        const d = cap.angle - dir;
        const capReach =
          Math.abs(capHalfLen * Math.cos(d)) + Math.abs(capHalfThick * Math.sin(d));
        // Negative means they overlap, which is what we want. Positive is a gap.
        expect(dist - armHalfLen - capReach).toBeLessThanOrEqual(1e-9);
      }
    },
  );

  // Edits key on t, so nodes sharing a t are indistinguishable to edit lookup.
  // All three fan stones once carried the vertex's t, which meant dragging any
  // of them moved whichever came first and two could never be moved at all.
  it('gives every node a distinct t', () => {
    for (const pts of [
      [[0, 0], [10, 0], [2, 3]],
      [[0, 0], [10, 0], [16, 6], [26, 2]],
    ] as [number, number][][]) {
      const ts = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 4 }).map((n) => n.t);
      expect(new Set(ts).size).toBe(ts.length);
    }
  });

  it('gives a closed polygon distinct node t values too', () => {
    const ts = run(ngon(0, 0, 6, 6), true).map((n) => n.t);
    expect(new Set(ts).size).toBe(ts.length);
  });

  it('lets each of the three fan stones be moved independently', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [2, 3]];
    const nodes = layoutWall(pts, false, STONE, { wallWidth: WIDTH, seed: 4 });
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans).toHaveLength(3);

    for (const target of fans) {
      const out = applyWallEdits(nodes, { nodeEdits: [{ t: target.t, dx: 5, dy: 5 }] });
      const moved = out.filter(
        (n) => !nodes.some((o) => o.t === n.t && o.x === n.x && o.y === n.y),
      );
      expect(moved).toHaveLength(1);
      expect(moved[0].t).toBeCloseTo(target.t, 12);
    }
  });

  it('puts the cover stone exactly on the vertex', () => {
    const nodes = layoutWall([[0, 0], [10, 0], [2, 5]], false, STONE, {
      wallWidth: WIDTH,
      seed: 4,
    });
    const fans = nodes.filter((n) => n.kind === 'fan');
    const onVertex = fans.filter((f) => Math.hypot(f.x - 10, f.y - 0) < 1e-9);
    expect(onVertex).toHaveLength(1);
  });

  it('degrades safely on junk input', () => {
    expect(layoutWall([], false, STONE, { wallWidth: WIDTH })).toEqual([]);
    expect(layoutWall([[1, 1]], false, STONE, { wallWidth: WIDTH })).toEqual([]);
    expect(layoutWall([[0, 0], [0, 0]], false, STONE, { wallWidth: WIDTH })).toEqual([]);
    expect(layoutWall([[0, 0], [5, 0]], false, [], { wallWidth: WIDTH })).toEqual([]);
  });
});
