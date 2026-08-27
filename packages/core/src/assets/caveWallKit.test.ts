import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import kit from './caveWallKit.json';
import { caveBandPieces, mirrorPiece, jointsOf, placeOnChord, type CaveKitPiece } from './caveWallKit';

const RAW = kit as { key: string; jointsCells: number[][]; chordCells: number; turnDeg: number }[];

const dist = (a: [number, number], b: [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('caveWallKit measurements', () => {
  it('carries the family handedness the generator relies on', () => {
    // Walking with the void on the left, an inside bend IS the convex floor
    // corner and an outside bend the concave one. A piece whose turn disagrees
    // with its family gets placed back-to-front, putting the rock's drop shadow
    // indoors and its loose pebbles out in the void. The fix is applied once, at
    // measurement time, so this is the assertion that it stayed applied.
    for (const p of RAW) {
      const want = p.key.startsWith('inside_bend')
        ? 90
        : p.key.startsWith('outside_bend')
          ? -90
          : 0;
      expect(`${p.key}:${p.turnDeg}`).toBe(`${p.key}:${want}`);
    }
  });

  it("agrees with itself: the file's chordCells label matches its own joints", () => {
    // The module derives the chord from the joints rather than reading this
    // field, so the two can only drift if a re-measure writes something genuinely
    // inconsistent. 0.005 is the field's own rounding, not a fudge factor.
    for (const p of RAW) {
      const [a, b] = p.jointsCells;
      const measured = Math.hypot(a[0] - b[0], a[1] - b[1]);
      expect(Math.abs(measured - p.chordCells)).toBeLessThan(0.005);
    }
  });

  it('offers only band pieces to the solver, with mirrors of straights only', () => {
    const pool = caveBandPieces();
    expect(pool.some((p) => p.key.startsWith('ledge'))).toBe(false);
    // Mirroring a bend turns it into the other family's shape, so a mirrored
    // bend in the pool would let the solver place a piece that does not exist.
    expect(pool.filter((p) => p.flipY).every((p) => p.turnDeg === 0)).toBe(true);
    const straights = pool.filter((p) => p.turnDeg === 0 && !p.flipY);
    expect(pool.filter((p) => p.flipY)).toHaveLength(straights.length);
  });

  it('mirrors a straight without changing what it spans', () => {
    const straight = caveBandPieces().find((p) => p.turnDeg === 0 && !p.flipY)!;
    const m = mirrorPiece(straight);
    expect(m.flipY).toBe(true);
    expect(m.chordCells).toBeCloseTo(straight.chordCells, 6);
    const [a, b] = m.jointsCells;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(straight.chordCells, 6);
  });
});

describe('placeOnChord', () => {
  // The band editor maps a piece onto a chord and then reads its joints back to
  // decide where the next one starts. If those two are not exact inverses the
  // chain drifts a little at every joint and the wall opens up along the run.
  const chords: [[number, number], [number, number]][] = [
    [
      [0, 0],
      [3.97, 0],
    ],
    [
      [12.5, -4.25],
      [15.1, 1.3],
    ],
    [
      [-6, 9],
      [-9.4, 6.2],
    ],
  ];

  const roundTrip = (piece: CaveKitPiece): void => {
    for (const [p, q] of chords) {
      const at = placeOnChord(piece, p, q);
      const [j0, j1] = jointsOf(piece, at);
      expect(dist(j0, p)).toBeLessThan(1e-9);
      expect(dist(j1, q)).toBeLessThan(1e-9);
    }
  };

  it('lands both joints on the chord, for every piece', () => {
    for (const piece of caveBandPieces()) roundTrip(piece);
  });

  it('lands both joints on the chord for a mirrored piece too', () => {
    // The trap this guards: mirroring lives in the piece, so a placement that
    // also honoured `flipY` would flip twice and land the joints on the wrong
    // side of the run — invisible in the numbers, obvious as a torn wall.
    const straight = caveBandPieces().find((p) => p.turnDeg === 0 && !p.flipY)!;
    const m = mirrorPiece(straight);
    roundTrip(m);
    expect(placeOnChord(m, [0, 0], [m.chordCells, 0]).flipY).toBe(true);
  });

  it('scales a piece only by how far the chord differs from its own', () => {
    const piece = caveBandPieces().find((p) => p.key === 'wall_short_2x4')!;
    const at = placeOnChord(piece, [0, 0], [piece.chordCells, 0]);
    // A piece spanning exactly its own chord must render untouched: the engine
    // scales sprites uniformly, so a stretched piece is a visibly thicker piece.
    expect(at.scale).toBeCloseTo(1, 9);
  });
});

describe('the join to the shipped pack', () => {
  it('resolves every measured piece to exactly one gg-demo entry', () => {
    // `material` + `gridSize` is how a measurement finds its art. The pack cannot
    // be rebuilt from inside this repo, so if that join ever stops being 1:1 the
    // band editor silently stops recognising walls rather than failing loudly.
    // From process.cwd() (packages/core under vitest), not import.meta.url: the
    // jsdom environment hands that back as an http URL.
    const dir = resolve(process.cwd(), '../../canvas/public/packs/gg-demo');
    const manifestFile = readdirSync(dir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))!;
    const entries: Record<string, { type: string; material: string; gridSize: string }> = JSON.parse(
      readFileSync(`${dir}/${manifestFile}`, 'utf8'),
    ).entries;

    for (const p of RAW) {
      const matches = Object.entries(entries).filter(
        ([, e]) => e.type === 'object' && `${e.material}_${e.gridSize}` === p.key,
      );
      expect(`${p.key} → ${matches.length} entries`).toBe(`${p.key} → 1 entries`);
    }
  });
});
