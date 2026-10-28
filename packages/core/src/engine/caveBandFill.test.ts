// The ground strip behind a cave band's rock: one pooled Graphics per band,
// under that band's sprites, in a darker shade of the floor it stands on, and
// only on the void side of the edge.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../assets/textureLoader', async () => {
  const { Texture, TextureSource } = await import('pixi.js');
  const tex = new Texture({ source: new TextureSource({ width: 400, height: 400 }) });
  return { resolveTexture: () => tex };
});

import { Container, Graphics, Sprite } from 'pixi.js';
import { caveBandPieces } from '../assets/caveWallKit';
import type { CatalogEntry } from '../assets/packCatalog';
import {
  BAND_FILL_REACH,
  BAND_FILL_SHADE,
  bandFillColor,
  drawBandFill,
  layBandChain,
  layBandRing,
  orientRings,
  placeBand,
  ringFloorOf,
  rockSpan,
  shadeGround,
  type BandFillSpec,
} from './caveBandRenderer';
import type { Polygon } from '../types/geometry';
import type { DungeonLayer } from '../store/types';

/** Every kit piece's art, as the band set hands it over. */
const art = new Map<string, CatalogEntry>(
  caveBandPieces().map((p) => [
    p.key,
    { id: 'kit:' + p.key, naturalWidth: 400, naturalHeight: 400 } as CatalogEntry,
  ]),
);

const rect = (w: number, h: number): Polygon => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** A Graphics stand-in that keeps every polygon and fill it is given. */
function recorder() {
  const polys: number[][] = [];
  const fills: number[] = [];
  const g = {
    clear: () => g,
    poly: (pts: number[]) => {
      polys.push(pts);
      return g;
    },
    fill: (style: { color: number }) => {
      fills.push(style.color);
      return g;
    },
  };
  return { g: g as unknown as Graphics, polys, fills };
}

/** Signed distance of `p` past the rectangle's nearest side, positive outside (the void). */
function outside(p: [number, number], w: number, h: number): number {
  const dx = Math.max(-p[0], p[0] - w);
  const dy = Math.max(-p[1], p[1] - h);
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

describe('band ground strip colour', () => {
  it('is the floor colour shaded darker, channel by channel', () => {
    expect(shadeGround(0xffffff)).toBe(
      (Math.round(255 * BAND_FILL_SHADE) << 16) | (Math.round(255 * BAND_FILL_SHADE) << 8) | Math.round(255 * BAND_FILL_SHADE),
    );
    const c = bandFillColor({ floorColor: '#b8ac92' });
    expect(c).toBe(shadeGround(0xb8ac92));
    // darker than the floor in every channel, and still a floor tone (same channel order)
    expect((c >> 16) & 255).toBeLessThan(0xb8);
    expect((c >> 8) & 255).toBeLessThan(0xac);
    expect(c & 255).toBeLessThan(0x92);
    expect((c >> 16) & 255).toBeGreaterThan((c >> 8) & 255);
  });

  it('reads the floor that owns each ring, its own colour override included', () => {
    const layer = {
      style: { floorColor: '#808080', defaultTextureId: '' },
      mergedFloor: [rect(4, 4), rect(4, 4).map(([x, y]) => [x + 10, y] as [number, number])],
      children: [
        { childType: 'shape', id: 'a', visible: true, contours: [rect(4, 4)], textureTint: '#ffffff' },
        {
          childType: 'shape',
          id: 'b',
          visible: true,
          contours: [rect(4, 4).map(([x, y]) => [x + 10, y])],
          textureTint: '#ffffff',
          styleOverrides: { floorColor: '#a08060' },
        },
      ],
    } as unknown as DungeonLayer;
    const floorOf = ringFloorOf(layer);
    expect(floorOf(0).floorColor).toBe('#808080');
    expect(floorOf(1).floorColor).toBe('#a08060');
    // a drawn wall takes the main floor's
    expect(floorOf(-1).floorColor).toBe('#808080');
  });
});

describe('drawBandFill', () => {
  it('covers only the void side of a ring, out to the reach, never the floor', () => {
    const [ring] = orientRings([rect(12, 9)]);
    const { g, polys, fills } = recorder();
    drawBandFill(g, { edge: ring, closed: true, gaps: [], color: 0x123456 });
    // four sides, four bevels at the outer corners
    expect(polys.length).toBe(8);
    expect(new Set(fills)).toEqual(new Set([0x123456]));
    for (const pts of polys) {
      for (let i = 0; i < pts.length; i += 2) {
        const d = outside([pts[i], pts[i + 1]], 12, 9);
        expect(d).toBeGreaterThan(-1e-6);
        expect(d).toBeLessThan(BAND_FILL_REACH + 1e-6);
      }
    }
  });

  it('stays inside a hole and leaves its middle bare', () => {
    // A 3x3 hole in a 12x9 room: the hole winds opposite, void on its inside.
    const hole: Polygon = [
      [4, 3],
      [7, 3],
      [7, 6],
      [4, 6],
    ];
    const [, h] = orientRings([rect(12, 9), hole]);
    const { g, polys } = recorder();
    drawBandFill(g, { edge: h, closed: true, gaps: [], color: 1 });
    for (const pts of polys) {
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = [pts[i], pts[i + 1]];
        expect(x).toBeGreaterThanOrEqual(4 - 1e-6);
        expect(x).toBeLessThanOrEqual(7 + 1e-6);
        expect(y).toBeGreaterThanOrEqual(3 - 1e-6);
        expect(y).toBeLessThanOrEqual(6 + 1e-6);
        // every point within the reach of the hole's edge: the middle stays void
        const edge = Math.min(x - 4, 7 - x, y - 3, 6 - y);
        expect(edge).toBeLessThanOrEqual(BAND_FILL_REACH + 1e-6);
      }
    }
  });

  it('stops at a door opening, where the rock stops', () => {
    const [ring] = orientRings([rect(12, 9)]);
    const gap = { wallId: 'floor:0:0', position: [6, 0] as [number, number], width: 1, ring: 0 };
    const { g, polys } = recorder();
    drawBandFill(g, { edge: ring, closed: true, gaps: [gap], color: 1 });
    for (const pts of polys) {
      for (let i = 0; i < pts.length; i += 2) {
        const onTop = Math.abs(pts[i + 1]) < 1e-6;
        if (onTop) expect(Math.abs(pts[i] - 6)).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});

describe('placeBand with a ground strip', () => {
  const ring = orientRings([rect(12, 9)])[0];
  const spec = (color = 0x445566): BandFillSpec => ({ edge: ring, closed: true, gaps: [], color });

  it('puts one Graphics under the band, then its sprites, and reuses both', () => {
    const parent = new Container();
    const placed = layBandRing(ring);
    expect(placed.length).toBeGreaterThan(4);
    const end = placeBand(parent, placed, art, 0xffffff, 0, spec());
    expect(end).toBe(placed.length + 1);
    expect(parent.children[0]).toBeInstanceOf(Graphics);
    expect(parent.children.slice(1).every((c) => c instanceof Sprite)).toBe(true);
    const g = parent.children[0];
    const s = parent.children[1];
    placeBand(parent, placed, art, 0xffffff, 0, spec());
    expect(parent.children[0]).toBe(g);
    expect(parent.children[1]).toBe(s);
    expect(parent.children.length).toBe(placed.length + 1);
  });

  it('builds one strip per band, each under its own rock', () => {
    const parent = new Container();
    const a = layBandRing(ring);
    const b = layBandChain([
      [20, 0],
      [26, 0],
    ]);
    let at = placeBand(parent, a, art, 0xffffff, 0, spec());
    at = placeBand(parent, b, art, 0xffffff, at, {
      edge: [
        [20, 0],
        [26, 0],
      ],
      closed: false,
      gaps: [],
      color: 1,
    });
    const kinds = parent.children.map((c) => (c instanceof Graphics ? 'G' : 'S')).join('');
    expect(kinds).toBe('G' + 'S'.repeat(a.length) + 'G' + 'S'.repeat(b.length));
    expect(at).toBe(parent.children.length);
  });

  it('draws nothing for a band the walk laid no rock for', () => {
    const parent = new Container();
    expect(placeBand(parent, [], art, 0xffffff, 0, spec())).toBe(0);
    expect(parent.children.length).toBe(0);
  });

  it('never dresses a strip up as a sprite when the pool changes kind', () => {
    const parent = new Container();
    const placed = layBandRing(ring);
    placeBand(parent, placed, art, 0xffffff, 0, spec());
    // the same slots, now laid without a strip: sprites must not land on the Graphics
    const end = placeBand(parent, placed, art, 0xffffff, 0);
    expect(parent.children.slice(0, end).every((c) => c instanceof Sprite)).toBe(true);
  });

  it('fills in the shaded floor colour it is handed', () => {
    const parent = new Container();
    const color = bandFillColor({ floorColor: '#7a6a58' });
    placeBand(parent, layBandRing(ring), art, 0xffffff, 0, spec(color));
    const g = parent.children[0] as Graphics;
    const styles = g.context.instructions
      .filter((i) => i.action === 'fill')
      .map((i) => (i.data as { style: { color: number } }).style.color);
    expect(styles.length).toBeGreaterThan(0);
    expect(new Set(styles)).toEqual(new Set([color]));
  });
});

describe('rockSpan', () => {
  it('spans an open run only as far as its rock reaches', () => {
    const line: Polygon = [
      [0, 0],
      [6, 0],
    ];
    const span = rockSpan(line, layBandChain(line));
    expect(span).not.toBeNull();
    expect(span![0]).toBeGreaterThanOrEqual(0);
    expect(span![1]).toBeLessThanOrEqual(6 + 1e-6);
    expect(span![1] - span![0]).toBeGreaterThan(4);
  });
});
