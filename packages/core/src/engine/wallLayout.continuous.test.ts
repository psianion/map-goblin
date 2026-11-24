// A continuous wall set (one outlined band, not a row of stones): a turn no authored
// corner fits is mitred, both runs carried past the vertex to the outer mitre point
// and cut along the bisector; a turn sharper than 135 degrees (a hairpin) is rounded off into
// turns of 60 degrees or less, mitred alike, and an opening with no jambs of its own is closed
// by the set's end piece either side. A set without the trait lays exactly as before.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutWall, pieceWorldLength, roundHairpins, type WallNode, type WallPieceSpec } from './wallLayout';
import { buildPieceSpecs, gapEndings } from './wallNodeRenderer';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import type { ManifestEntry } from './packManifest';

const SET = 'Test_Outline';
const WIDTH = 0.5;
/** `fingerprint` of the octagon below, measured on the layout before the trait existed. */
const OCTAGON_BEFORE = '16:310234c1';

function wallEntry(stem: string, pieceType: string, w: number, contentRect?: ManifestEntry['contentRect']): ManifestEntry {
  return {
    type: 'wall',
    material: `${SET}_${stem}`,
    gridSize: `${Math.round(w / 200)}x1`,
    pieceType,
    variant: 'A',
    frame: { x: 0, y: 0, w, h: 200 },
    contentRect,
    set: SET,
    tags: [],
  };
}

const band = (w: number) => ({ x: 0, y: 66, w, h: 68 });

let specs: WallPieceSpec[];

beforeEach(() => {
  seedPack('test-walls', {
    s3: wallEntry('Straight_3x1', 'straight', 600, band(600)),
    s2: wallEntry('Straight_2x1', 'straight', 400, band(400)),
    s1: wallEntry('Straight_1x1', 'straight', 200, band(200)),
    c1: wallEntry('Connector_A_1x1', 'connector', 200, { x: 51, y: 66, w: 99, h: 68 }),
    k1: wallEntry('Corner_A_1x1', 'corner', 200),
    e1: wallEntry('Ending_A_1x1', 'ending', 200),
  });
  specs = buildPieceSpecs(SET);
});

afterEach(() => resetAssetPackManager());

const octagon = (r: number): [number, number][] =>
  Array.from({ length: 8 }, (_, i): [number, number] => [r * Math.cos((i * Math.PI) / 4), r * Math.sin((i * Math.PI) / 4)]);

const near = (n: WallNode, [x, y]: [number, number]) => Math.hypot(n.x - x, n.y - y) < 1e-6;

/** A short, stable fingerprint of a layout: every node's kind, piece and place. */
function fingerprint(nodes: WallNode[]): string {
  const text = nodes
    .map((n) => `${n.kind}:${n.pieceId}:${n.x.toFixed(4)},${n.y.toFixed(4)}:${n.angle.toFixed(4)}:${n.scale.toFixed(4)}`)
    .join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${nodes.length}:${(h >>> 0).toString(16)}`;
}

/** The straights lying on the line of edge a→b, as intervals along it from `a`. */
function spansOn(nodes: WallNode[], a: [number, number], b: [number, number]): { node: WallNode; lo: number; hi: number }[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  return nodes
    .filter((n) => n.kind === 'straight')
    .filter((n) => Math.abs(-(n.x - a[0]) * uy + (n.y - a[1]) * ux) < 1e-6)
    .map((n) => {
      const along = (n.x - a[0]) * ux + (n.y - a[1]) * uy;
      const half = (pieceWorldLength(byId.get(n.pieceId)!, WIDTH) * n.scale) / 2;
      return { node: n, lo: along - half, hi: along + half };
    })
    .filter(({ lo, hi }) => lo > -1 && hi < len + 1);
}

/** A two-edge chain turning `deg` at [6, 0]. */
const bend = (deg: number): [number, number][] => {
  const r = (deg * Math.PI) / 180;
  return [[0, 0], [6, 0], [6 + 6 * Math.cos(r), 6 * Math.sin(r)]];
};

describe('layoutWall: continuous sets', () => {
  for (const deg of [45, 120]) {
    it(`mitres a ${deg} degree bend: no cap, each run carried past the vertex and cut on the bisector`, () => {
      const pts = bend(deg);
      const nodes = layoutWall(pts, false, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
      expect(nodes.some((n) => n.kind === 'fan')).toBe(false);

      const ext = (WIDTH / 2) * Math.tan((deg * Math.PI) / 360);
      const into = spansOn(nodes, pts[0], pts[1]);
      const out = spansOn(nodes, pts[1], pts[2]);
      // Every straight lies on its own edge's line, and only there.
      const straights = nodes.filter((n) => n.kind === 'straight');
      expect(into.length + out.length).toBe(straights.length);
      expect(into.every(({ node }) => !out.some((o) => o.node === node))).toBe(true);
      expect(Math.max(...into.map((s) => s.hi))).toBeCloseTo(6 + ext, 6);
      expect(Math.min(...out.map((s) => s.lo))).toBeCloseTo(-ext, 6);
      // None strays round the corner onto the other edge.
      expect(into.every(({ node }) => node.t < 0.5)).toBe(true);
      expect(out.every(({ node }) => node.t > 0.5)).toBe(true);

      // The end stones carry the cut, on the bisector through the vertex, each keeping its own side.
      const r = (deg * Math.PI) / 180;
      const tl = Math.hypot(1 + Math.cos(r), Math.sin(r));
      const t: [number, number] = [(1 + Math.cos(r)) / tl, Math.sin(r) / tl];
      const last = into.reduce((m, s) => (s.hi > m.hi ? s : m)).node;
      const first = out.reduce((m, s) => (s.lo < m.lo ? s : m)).node;
      expect(last.clips).toHaveLength(1);
      expect(first.clips).toHaveLength(1);
      for (const [node, keep] of [[last, -1], [first, 1]] as const) {
        const c = node.clips![0];
        expect(c.x).toBeCloseTo(6, 9);
        expect(c.y).toBeCloseTo(0, 9);
        expect(c.nx).toBeCloseTo(keep * t[0], 9);
        expect(c.ny).toBeCloseTo(keep * t[1], 9);
      }
      // Stones clear of the bisector are drawn whole.
      expect(straights.filter((n) => n.clips).length).toBeLessThan(straights.length);
    });
  }

  it('mitres each octagon vertex: no caps, every edge’s straights run on past both its vertices', () => {
    const pts = octagon(6);
    const nodes = layoutWall(pts, true, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    expect(nodes.some((n) => n.kind === 'fan')).toBe(false);
    const ext = (WIDTH / 2) * Math.tan(Math.PI / 8);
    const straights = nodes.filter((n) => n.kind === 'straight');
    let found = 0;
    for (let e = 0; e < 8; e++) {
      const a = pts[e];
      const b = pts[(e + 1) % 8];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const spans = spansOn(nodes, a, b);
      found += spans.length;
      expect(spans.length).toBeGreaterThan(0);
      expect(Math.min(...spans.map((s) => s.lo))).toBeCloseTo(-ext, 6);
      expect(Math.max(...spans.map((s) => s.hi))).toBeCloseTo(len + ext, 6);
    }
    expect(found).toBe(straights.length);
  });

  it('rounds a hairpin sharper than 135 degrees off into turns of 60 degrees or less, each mitred', () => {
    const pts = bend(150);
    const nodes = layoutWall(pts, false, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    expect(nodes.filter((n) => n.kind === 'fan')).toEqual([]);
    expect(nodes.some((n) => n.clips)).toBe(true);
    const rounded = roundHairpins(pts.map(([x, y]) => ({ x, y })), false, pieceWorldLength(specs.find((p) => p.role === 'straight' && p.lengthPx === 200)!, WIDTH));
    expect(rounded).toHaveLength(pts.length + 2);
    for (let k = 1; k + 1 < rounded.length; k++) {
      const [a, b, c] = [rounded[k - 1], rounded[k], rounded[k + 1]];
      const turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
      expect(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
    }
    // Ends where it began and where it was going: the rounding is only at the turn.
    expect(rounded[0]).toEqual({ x: pts[0][0], y: pts[0][1] });
    expect(rounded[rounded.length - 1]).toEqual({ x: pts[2][0], y: pts[2][1] });
  });

  it('caps a turn all the way back, which no rounding can take, with its cover stone as before', () => {
    const pts: [number, number][] = [[0, 0], [6, 0], [0, 0.001]];
    const nodes = layoutWall(pts, false, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    expect(nodes.filter((n) => n.kind === 'fan')).toHaveLength(1);
  });

  it('lays the same octagon without the trait exactly as before', () => {
    const pts = octagon(6);
    const plain = layoutWall(pts, true, specs, { wallWidth: WIDTH, seed: 3 });
    expect(layoutWall(pts, true, specs, { wallWidth: WIDTH, seed: 3, continuous: false })).toEqual(plain);
    expect(fingerprint(plain)).toBe(OCTAGON_BEFORE);
  });

  it('keeps the authored corners on a square', () => {
    const pts: [number, number][] = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const nodes = layoutWall(pts, true, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    const corners = nodes.filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(4);
    for (const v of pts) expect(corners.filter((n) => near(n, v))).toHaveLength(1);
    expect(nodes.some((n) => n.kind === 'fan')).toBe(false);
    expect(nodes.some((n) => n.clips)).toBe(false);
  });
});

describe('a continuous wall at an opening', () => {
  const resolved = () => ({ specs, specById: new Map(specs.map((p) => [p.id, p])), colored: false, continuous: true, joints: new Map() });

  it('caps the wall either side of an opening with no jambs with the set’s end piece, facing into it', () => {
    const caps = gapEndings([{ wallId: 'w', position: [4, 0], width: 1.2 }], [[0, 0], [8, 0]], false, resolved() as never, SET, WIDTH);
    expect(caps).toHaveLength(2);
    expect(caps.every((n) => n.kind === 'ending' && n.pieceId === specs.find((p) => p.role === 'ending')!.id)).toBe(true);
    const [left, right] = [...caps].sort((a, b) => a.x - b.x);
    expect([left.x, left.y]).toEqual([3.4, 0]);
    expect([right.x, right.y]).toEqual([4.6, 0]);
    // Each faces the opening: the left one along the wall, the right one back along it.
    expect(Math.cos(left.angle)).toBeCloseTo(1, 9);
    expect(Math.cos(right.angle)).toBeCloseTo(-1, 9);
  });

  it('leaves an opening at the wall’s own end with one cap, and one away from the wall with none', () => {
    expect(gapEndings([{ wallId: 'w', position: [0.6, 0], width: 1.2 }], [[0, 0], [8, 0]], false, resolved() as never, SET, WIDTH)).toHaveLength(1);
    expect(gapEndings([{ wallId: 'w', position: [4, 3], width: 1.2 }], [[0, 0], [8, 0]], false, resolved() as never, SET, WIDTH)).toEqual([]);
  });

  it('lays no caps for a set that is not continuous, or one whose doors bring their own jambs', () => {
    const gap = [{ wallId: 'w', position: [4, 0] as [number, number], width: 1.2 }];
    expect(gapEndings(gap, [[0, 0], [8, 0]], false, { ...resolved(), continuous: false } as never, SET, WIDTH)).toEqual([]);
    expect(gapEndings(gap, [[0, 0], [8, 0]], false, resolved() as never, 'GG_Fieldstone', WIDTH)).toEqual([]);
  });
});
