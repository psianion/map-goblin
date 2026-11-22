// A continuous wall set (one outlined band, not a row of stones): a turn no authored
// corner fits is mitred, both runs carried past the vertex to the outer mitre point
// and cut along the bisector; a turn sharper than 135 degrees is carried by its cover
// stone alone, over straights that run right up to the vertex. A set without the
// trait lays exactly as before.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutWall, pieceWorldLength, type WallNode, type WallPieceSpec } from './wallLayout';
import { buildPieceSpecs } from './wallNodeRenderer';
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

  it('still caps a turn sharper than 135 degrees, over straights that run to the vertex', () => {
    const pts = bend(150);
    const nodes = layoutWall(pts, false, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans).toHaveLength(1);
    expect(near(fans[0], pts[1])).toBe(true);
    expect(nodes.some((n) => n.clips)).toBe(false);
    expect(Math.max(...spansOn(nodes, pts[0], pts[1]).map((s) => s.hi))).toBeCloseTo(6, 2);
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
