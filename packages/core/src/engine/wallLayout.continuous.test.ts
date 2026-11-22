// A continuous wall set (one outlined band, not a row of stones): a turn no authored
// corner fits is carried by its cover stone alone, over straights that run right up
// to the vertex. A set without the trait lays exactly as before.
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

describe('layoutWall: continuous sets', () => {
  it('caps each octagon vertex with one stone, no arms, and runs the straights up to it', () => {
    const pts = octagon(6);
    const nodes = layoutWall(pts, true, specs, { wallWidth: WIDTH, seed: 3, continuous: true });
    const fans = nodes.filter((n) => n.kind === 'fan');
    expect(fans).toHaveLength(8);
    for (const v of pts) expect(fans.filter((n) => near(n, v))).toHaveLength(1);

    const byId = new Map(specs.map((s) => [s.id, s]));
    for (let e = 0; e < 8; e++) {
      const a = pts[e];
      const b = pts[(e + 1) % 8];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      // The straights on this edge, as intervals along it from `a`.
      const spans = nodes
        .filter((n) => n.kind === 'straight')
        .filter((n) => Math.abs(-(n.x - a[0]) * uy + (n.y - a[1]) * ux) < 1e-6)
        .map((n) => {
          const along = (n.x - a[0]) * ux + (n.y - a[1]) * uy;
          const half = (pieceWorldLength(byId.get(n.pieceId)!, WIDTH) * n.scale) / 2;
          return [along - half, along + half];
        })
        .filter(([lo, hi]) => lo > -0.5 && hi < len + 0.5);
      expect(spans.length).toBeGreaterThan(0);
      expect(Math.abs(Math.min(...spans.map((s) => s[0])))).toBeLessThan(0.02);
      expect(Math.abs(len - Math.max(...spans.map((s) => s[1])))).toBeLessThan(0.02);
    }
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
  });
});
