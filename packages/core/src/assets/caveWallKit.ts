// The cave wall kit: what gg-demo's rock band pieces actually measure.
//
// These walls are not composed stones. A cave band is a run of ordinary asset
// children, one per rock piece, each mapped so its two butt joints land on a
// chord of the floor outline (see scripts/gen-goblin-warren.mjs). Editing that
// band means knowing where a piece's joints are and which chords the kit can
// span, so the measurements have to live where the engine can read them.
//
// `caveWallKit.json` is measured from the source art by scripts/cave/measure-pieces.mjs,
// not authored. It carries the family handedness fix already applied: an inside
// bend always turns +90 and an outside bend always -90 walking with the void on
// the left. The per-piece void-centroid guess mis-reads on three pieces whose
// floor side carries a dark decorative crack, which is why handedness is a
// property of the family and is settled at measurement time rather than here.
//
// The manifest would be the natural home for this, but gg-demo cannot be rebuilt
// from inside this repo — its build inputs live outside it — so the measurements
// ride alongside instead, joined to pack entries by `material` + `gridSize`.

import kit from './caveWallKit.json';
import { getCatalogEntry } from './packCatalog';

/** One measured kit piece. Lengths are in grid cells, angles in degrees. */
export interface CaveKitPiece {
  /** `<material>_<gridSize>`, e.g. `wall_short_2x4`. Joins to a pack entry. */
  key: string;
  /** The two butt joints, in cells from the sprite's centre. */
  jointsCells: [[number, number], [number, number]];
  /** Straight-line distance between the joints. A piece spans exactly this. */
  chordCells: number;
  /** Signed turn of the rock band across the piece: 0, +90 or -90. */
  turnDeg: number;
  /** True for a piece derived by mirroring a straight along its length. */
  flipY?: boolean;
}

interface RawPiece {
  key: string;
  jointsCells: number[][];
  chordCells: number;
  turnDeg: number;
}

const RAW = kit as RawPiece[];

function toPiece(p: RawPiece): CaveKitPiece {
  const [a, b] = p.jointsCells;
  return {
    key: p.key,
    jointsCells: [
      [a[0], a[1]],
      [b[0], b[1]],
    ],
    // Derived, not read: the file's own `chordCells` is rounded for legibility,
    // and a solver that matched a chord against the rounded number would place
    // every piece at a scale a hair off 1 — uniform scale means that is a hair
    // off in THICKNESS too, on every stone in the wall. The joints are the
    // measurement; the field is a label. `caveWallKit.test.ts` holds them to
    // each other so a real disagreement still surfaces.
    chordCells: Math.hypot(a[0] - b[0], a[1] - b[1]),
    turnDeg: p.turnDeg,
  };
}

const BY_KEY = new Map<string, CaveKitPiece>(RAW.map((p) => [p.key, toPiece(p)]));

/**
 * The same piece flipped along its length.
 *
 * gg-demo ships one variant per length, so a long run repeats the same rock down
 * the wall. Mirroring a STRAIGHT leaves the void on the same side and buys a
 * second face for free; the joints swap ends and negate y, which is exactly what
 * the sprite's own `flipY` does to them. Bends cannot do this — mirroring one
 * turns it into the other family's shape — so this is only ever applied to a
 * piece whose turn is zero.
 */
export function mirrorPiece(p: CaveKitPiece): CaveKitPiece {
  const [a, b] = p.jointsCells;
  return {
    ...p,
    jointsCells: [
      [b[0], -b[1]],
      [a[0], -a[1]],
    ],
    flipY: true,
  };
}

/** True for a piece that forms the wall band itself, rather than ledge dressing. */
function isBandKey(key: string): boolean {
  return (
    key.startsWith('wall_short_') ||
    key.startsWith('inside_bend_') ||
    key.startsWith('outside_bend_')
  );
}

/**
 * Every piece the band solver may place, mirrors included.
 *
 * Built once: the measurements never change at runtime, and the solver runs per
 * pointermove during a drag.
 */
let bandPool: CaveKitPiece[] | null = null;
export function caveBandPieces(): CaveKitPiece[] {
  if (!bandPool) {
    const base = [...BY_KEY.values()].filter((p) => isBandKey(p.key));
    bandPool = [...base, ...base.filter((p) => p.turnDeg === 0).map(mirrorPiece)];
  }
  return bandPool;
}

/**
 * The kit piece a placed asset is showing, or null when it is not kit art.
 *
 * Joined through the catalog's `material` + `gridSize` rather than by parsing the
 * asset id: the id carries a variant suffix and a piece type that are not part of
 * a measurement's identity, and gg-demo's own filenames proved that parsing
 * identity out of a name is how families get confused for each other.
 */
export function caveKitPieceFor(assetId: string): CaveKitPiece | null {
  const entry = getCatalogEntry(assetId);
  if (!entry?.material) return null;
  return BY_KEY.get(`${entry.material}_${entry.gridSize}`) ?? null;
}

/** True when a placed asset is one of the band's rock pieces. */
export function isCaveBandAsset(assetId: string): boolean {
  const piece = caveKitPieceFor(assetId);
  return piece !== null && isBandKey(piece.key);
}

/**
 * The piece a placed asset is really showing, mirror included.
 *
 * A mirrored straight is a piece in its own right here — {@link mirrorPiece}
 * bakes the swapped, negated joints into `jointsCells` — so the mirror is
 * carried by the PIECE and never by the placement. That is the one rule that
 * keeps {@link jointsOf} and {@link placeOnChord} exact inverses: applying the
 * flip in both places would mirror twice and put every joint on the wrong side
 * of the run. Always come through here rather than pairing a base piece with a
 * child's `flipY` by hand.
 */
export function pieceForAsset(assetId: string, flipY = false): CaveKitPiece | null {
  const base = caveKitPieceFor(assetId);
  if (!base) return null;
  return flipY ? mirrorPiece(base) : base;
}

/** Where a placed asset sits. The subset of AssetChild this module needs. */
export interface KitPlacement {
  position: { x: number; y: number };
  rotation: number;
  scale: number;
  /** Rendering flag only — the joints already account for it (see pieceForAsset). */
  flipY?: boolean;
}

type Vec = [number, number];

const rot2 = (p: Vec, t: number): Vec => [
  p[0] * Math.cos(t) - p[1] * Math.sin(t),
  p[0] * Math.sin(t) + p[1] * Math.cos(t),
];

/**
 * A placed piece's two joints, in world units.
 *
 * The placement's `flipY` is deliberately not consulted: a mirrored piece already
 * carries mirrored joints (see {@link pieceForAsset}), so honouring the flag here
 * as well would mirror twice.
 */
export function jointsOf(piece: CaveKitPiece, at: KitPlacement): [Vec, Vec] {
  return piece.jointsCells.map((q): Vec => {
    const r = rot2(q, at.rotation);
    return [at.position.x + r[0] * at.scale, at.position.y + r[1] * at.scale];
  }) as [Vec, Vec];
}

/**
 * Map a piece so its first joint lands on `p` and its second on `q`.
 *
 * The inverse of {@link jointsOf}, and the same mapping the generator's
 * `placePiece` performs. Scale comes out uniform because the engine scales
 * sprites uniformly: a piece stretched to span a longer chord is also a THICKER
 * piece, which is why the solver treats chord length as something to match
 * rather than something to stretch to.
 */
export function placeOnChord(piece: CaveKitPiece, p: Vec, q: Vec): KitPlacement {
  const j = piece.jointsCells;
  const nat: Vec = [j[1][0] - j[0][0], j[1][1] - j[0][1]];
  const tgt: Vec = [q[0] - p[0], q[1] - p[1]];
  const natLen = Math.hypot(nat[0], nat[1]) || 1;
  const scale = Math.hypot(tgt[0], tgt[1]) / natLen;
  const rotation = Math.atan2(tgt[1], tgt[0]) - Math.atan2(nat[1], nat[0]);
  const anchor = rot2(j[0], rotation);
  return {
    position: { x: p[0] - anchor[0] * scale, y: p[1] - anchor[1] * scale },
    rotation,
    scale,
    // Carried through from the piece so the sprite renders the face the joints
    // were measured from; it plays no part in the geometry above.
    flipY: piece.flipY ?? false,
  };
}
