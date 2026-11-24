// The cave wall kit: what the forge's rock band pieces (GG_Cave_Ink, shipped in
// gg-forge) actually measure.
//
// These walls are not composed stones. A cave band is a run of rock pieces, each
// mapped so its two butt joints land on a chord of the floor outline, laid live
// by the wall renderer when a layer names the kit as its wall texture
// (caveBandRenderer.ts). Laying that band means knowing where a piece's joints
// are and which chords the kit can span, so the measurements have to live where
// the engine can read them.
//
// `caveWallKit.json` is measured from the drawn art by forge/cave-measure.mjs,
// not authored. It carries the family handedness fix already applied: an inside
// bend always turns +90 and an outside bend always -90 walking with the void on
// the left. Handedness is a property of the family and is settled at measurement
// time rather than here.
//
// The manifest would be the natural home for this, but the measurements ride
// alongside instead, joined to pack entries by `material` + `gridSize` — which
// is also why gg-demo's structures of the same names, measured differently, are
// never laid on these numbers (see bandSetArt in packCatalog.ts).

import kit from './caveWallKit.json';
import { BAND_DRAWN_WIDTH, getBandSet, getCatalogEntry, isMeasuredBandSet, isRunPiece, type CatalogEntry } from './packCatalog';

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
  /** The middle of the rock's solid body, joint 0 end to joint 1 end, in the joints' frame. */
  spine?: [number, number][];
  /** The middle of the fully solid rock across the piece, joint 0 end to joint 1 end, in the joints' frame: what a tapered end narrows toward. */
  middle?: [number, number][];
  /** True for a piece built from a pack's own measurements: its art butts, so every joint must lap in full. */
  exact?: boolean;
  /** A connector's solid body, cells: a round lump laid over a joint, never inside a run. */
  radius?: number;
  /** A straight whose rock steps sideways between its ends: its art runs square to its joints' sides, not along its chord. */
  step?: boolean;
  /** A dead end's cap: how far past its joints' chord the floor line round it lies, cells. */
  reach?: number;
  /** An entrance across a doorway in a cliff; `shadow` when it is dark inside. */
  entrance?: boolean;
  shadow?: boolean;
  /** Rock turning into a cut-stone wall, and which joint lies on the wall's centre line. */
  transition?: 'straight' | 'corner';
  wallJoint?: 0 | 1;
}

/**
 * How far a step piece's chord is turned off its art's run, radians: what its joints' sides are
 * turned back by from the chord. Nothing for any other piece.
 */
export function pieceSkew(p: CaveKitPiece): number {
  if (!p.step) return 0;
  const [a, b] = p.jointsCells;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return dx >= 0 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
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
    ...(p.spine && { spine: p.spine.map(([x, y]): [number, number] => [x, -y]).reverse() }),
    ...(p.middle && { middle: p.middle.map(([x, y]): [number, number] => [x, -y]).reverse() }),
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
 * Every piece the cave walk may place, mirrors included.
 *
 * Built once: the measurements never change at runtime, and the walk runs on
 * every redraw of a band.
 */
let bandPool: CaveKitPiece[] | null = null;
export function caveBandPieces(): CaveKitPiece[] {
  if (!bandPool) {
    const base = [...BY_KEY.values()].filter((p) => isBandKey(p.key));
    bandPool = [...base, ...base.filter((p) => p.turnDeg === 0).map(mirrorPiece)];
  }
  return bandPool;
}

interface MeasuredKit {
  pool: CaveKitPiece[];
  /** A cliff's free tip: a straight end tapering into the ground. */
  ends: CaveKitPiece[];
  /** Caps turning 180 degrees: a narrow passage's closed end (+180), a rock spur's tip (-180). */
  deadEnds: CaveKitPiece[];
  /** Step pieces, mirrors included. */
  steps: CaveKitPiece[];
  entrances: CaveKitPiece[];
  transitions: CaveKitPiece[];
  /** Measured as cave walls: the face looks at the floor side, the rock mass is the void side. */
  facesFloor: boolean;
  connectors: CaveKitPiece[];
  /** How wide the kit's rock is across, cells at its drawn size. */
  rockWidth: number;
  shadow: KitShadow;
}

/** The shadow a measured kit's wall lays on the floor beside its rock. */
export interface KitShadow {
  /** How far it reaches onto the floor past the rock, cells at the kit's drawn size. */
  reach: number;
  /** How dark it is against the rock, 0 to 1. */
  strength: number;
  /** The pieces' art carries a shadow of its own. */
  baked: boolean;
}

/** The shadow of a kit whose pack measures none. */
export const KIT_SHADOW: KitShadow = { reach: 0.6, strength: 0.45, baked: false };

/** Each measured kit, by every piece of the pool it lays with: the walk is handed the pieces alone. */
const pieceKits = new WeakMap<CaveKitPiece, MeasuredKit>();

/**
 * A measured kit's pieces, keyed on the catalog's own entry list for the set: that list
 * is rebuilt on every catalog version, so a pack installed or removed builds afresh.
 */
const measuredKits = new WeakMap<CatalogEntry[], MeasuredKit>();
const warnedDuplicate = new Set<string>();

function measuredKit(setId: string): MeasuredKit {
  const entries = getBandSet(setId);
  let kit = measuredKits.get(entries);
  if (kit) return kit;
  const byKey = new Map<string, { piece: CaveKitPiece; end: boolean; connector: boolean; rockWidth?: number; band: NonNullable<CatalogEntry['band']> }>();
  for (const e of entries) {
    if (!e.band) continue;
    const key = `${e.material}_${e.gridSize}`;
    if (byKey.has(key)) {
      if (import.meta.env?.DEV && !warnedDuplicate.has(`${setId}|${key}`)) {
        warnedDuplicate.add(`${setId}|${key}`);
        console.warn(`[band] ${setId} measures ${key} twice; keeping the first`);
      }
      continue;
    }
    const [a, b] = e.band.joints;
    byKey.set(key, {
      piece: {
        key,
        jointsCells: [
          [a[0], a[1]],
          [b[0], b[1]],
        ],
        chordCells: Math.hypot(a[0] - b[0], a[1] - b[1]),
        turnDeg: e.band.turnDeg,
        ...(e.band.spine && { spine: e.band.spine.map(([x, y]): [number, number] => [x, y]) }),
        ...(e.band.middle && { middle: e.band.middle.map(([x, y]): [number, number] => [x, y]) }),
        ...(e.band.connector && { radius: e.band.radius ?? 0 }),
        ...(e.band.step && { step: true }),
        ...(e.band.reach !== undefined && { reach: e.band.reach }),
        ...(e.band.entrance && { entrance: true, ...(e.band.shadow && { shadow: true }) }),
        ...(e.band.transition && { transition: e.band.transition, wallJoint: e.band.wallJoint ?? 0 }),
        exact: true,
      },
      end: !!e.band.end,
      connector: !!e.band.connector,
      rockWidth: e.band.rockWidth,
      band: e.band,
    });
  }
  const measuredPieces = [...byKey.values()];
  const inRun = measuredPieces.filter((m) => isRunPiece(m.band));
  const base = inRun.map((m) => m.piece);
  // The rock's width as the straights measure it, the middle one where they differ; a kit that
  // carries none is taken to be as wide as the built-in kit's rock.
  const widths = inRun
    .filter((m) => m.piece.turnDeg === 0 && (m.rockWidth ?? 0) > 0)
    .map((m) => m.rockWidth!)
    .sort((a, b) => a - b);
  const steps = measuredPieces.filter((m) => m.band.step).map((m) => m.piece);
  kit = {
    pool: [...base, ...base.filter((p) => p.turnDeg === 0).map(mirrorPiece)],
    ends: measuredPieces.filter((m) => m.end && Math.abs(m.piece.turnDeg) < 90).map((m) => m.piece),
    deadEnds: measuredPieces.filter((m) => m.end && Math.abs(m.piece.turnDeg) >= 179 && m.piece.reach !== undefined).map((m) => m.piece),
    steps: [...steps, ...steps.map(mirrorPiece)],
    entrances: measuredPieces.filter((m) => m.band.entrance).map((m) => m.piece),
    transitions: measuredPieces.filter((m) => m.band.transition).map((m) => m.piece),
    facesFloor: inRun.some((m) => m.band.faces === 'floor'),
    // Smallest first: a joint takes the smallest that covers it.
    connectors: measuredPieces
      .filter((m) => m.connector && (m.piece.radius ?? 0) > 0)
      .map((m) => m.piece)
      .sort((a, b) => a.radius! - b.radius!),
    rockWidth: widths.length > 0 ? widths[(widths.length - 1) >> 1] : BAND_DRAWN_WIDTH,
    shadow: shadowOf(inRun.map((m) => m.band)),
  };
  for (const p of kit.pool) pieceKits.set(p, kit);
  measuredKits.set(entries, kit);
  return kit;
}

/**
 * A kit's wall shadow as its pieces measure it: the middle reach and strength where they
 * differ, baked where any piece says so; KIT_SHADOW for what none of them carries.
 */
function shadowOf(bands: NonNullable<CatalogEntry['band']>[]): KitShadow {
  const middle = (xs: (number | undefined)[]): number | undefined => {
    const sorted = xs.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
    return sorted.length > 0 ? sorted[(sorted.length - 1) >> 1] : undefined;
  };
  return {
    reach: middle(bands.map((b) => b.shadowReach)) ?? KIT_SHADOW.reach,
    strength: middle(bands.map((b) => b.shadowStrength)) ?? KIT_SHADOW.strength,
    baked: bands.some((b) => b.shadowBaked === true),
  };
}

/** The wall shadow of the measured kit `set`'s pieces come from; null for any other set. */
export function kitShadow(set: readonly CaveKitPiece[]): KitShadow | null {
  return kitOf(set)?.shadow ?? null;
}

/** The connectors of the measured kit `set`'s pieces come from, smallest first. Empty for any other set. */
export function kitConnectors(set: readonly CaveKitPiece[]): CaveKitPiece[] {
  return kitOf(set)?.connectors ?? [];
}

/** The tapering ends of the measured kit `set`'s pieces come from. Empty for any other set. */
export function kitEnds(set: readonly CaveKitPiece[]): CaveKitPiece[] {
  return kitOf(set)?.ends ?? [];
}

/** The dead ends (caps turning 180 degrees) of the measured kit `set`'s pieces come from. Empty for any other set. */
export function kitDeadEnds(set: readonly CaveKitPiece[]): CaveKitPiece[] {
  return kitOf(set)?.deadEnds ?? [];
}

/** True when the measured kit `set`'s pieces come from was measured as cave walls: its face looks at its floor side. */
export function kitFacesFloor(set: readonly CaveKitPiece[]): boolean {
  return kitOf(set)?.facesFloor ?? false;
}

/** The step pieces of the measured kit `set`'s pieces come from, mirrors included. Empty for any other set. */
export function kitSteps(set: readonly CaveKitPiece[]): CaveKitPiece[] {
  return kitOf(set)?.steps ?? [];
}

/** How wide the rock of the kit `set`'s pieces come from is across, cells at its drawn size: the built-in kit's for any other set. */
export function kitRockWidth(set: readonly CaveKitPiece[]): number {
  return kitOf(set)?.rockWidth ?? BAND_DRAWN_WIDTH;
}

function kitOf(set: readonly CaveKitPiece[]): MeasuredKit | undefined {
  for (const p of set) {
    const found = pieceKits.get(p);
    if (found) return found;
  }
  return undefined;
}

/** The pieces a band set is laid with: its own measurements when its entries carry them, else the built-in cave kit. */
export function bandPiecesFor(setId: string | undefined): CaveKitPiece[] {
  return isMeasuredBandSet(setId) ? measuredKit(setId!).pool : caveBandPieces();
}

/** A measured kit's run-end pieces. Empty for a set without measurements. */
export function bandEndPiecesFor(setId: string): CaveKitPiece[] {
  return isMeasuredBandSet(setId) ? measuredKit(setId).ends : [];
}
/**
 * The same piece walked the other way: joints swapped, turn negated. Only for art that paints
 * no void side — the ledge — where it turns a convex bend into the concave one for free.
 */
export function reversePiece(p: CaveKitPiece): CaveKitPiece {
  const [a, b] = p.jointsCells;
  return { ...p, jointsCells: [b, a], turnDeg: -p.turnDeg };
}

/**
 * A cliff kit: one ledge family's straights (mirrors included) and bends. `family` is the key
 * prefix: `ledge` (the cave ink line) or `rockledge` (the cave rock row). A family that ships
 * bends of one hand only (the ink line, which paints no side) has each also reversed; one that
 * ships both hands (the rock row, which has a void side) is laid as measured. All drawn by the
 * forge, which writes their joints from its own geometry. The run ends (`<family>_end_*`) are
 * not in it: they are laid only at an open run's tips.
 */
const ledgePools = new Map<string, CaveKitPiece[]>();
export function ledgePieces(family = 'ledge'): CaveKitPiece[] {
  let pool = ledgePools.get(family);
  if (!pool) {
    const straights = [...BY_KEY.values()].filter(
      (p) => p.key.startsWith(`${family}_`) && !p.key.startsWith(`${family}_end_`) && p.turnDeg === 0,
    );
    const bends = [...BY_KEY.values()].filter((p) => p.key.startsWith(`${family}_bend_`));
    const bothHands = bends.some((p) => p.turnDeg > 0) && bends.some((p) => p.turnDeg < 0);
    pool = [...straights, ...straights.map(mirrorPiece), ...bends, ...(bothHands ? [] : bends.map(reversePiece))];
    ledgePools.set(family, pool);
  }
  return pool;
}

/** Every measured piece whose key starts with `prefix` (`ledge_end_`, `sliver_`, `contour`). */
export function kitPieces(prefix: string): CaveKitPiece[] {
  return [...BY_KEY.values()].filter((p) => p.key.startsWith(prefix));
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

/** Where a placed asset sits. The subset of AssetChild this module needs. */
export interface KitPlacement {
  position: { x: number; y: number };
  rotation: number;
  scale: number;
  /** Rendering flag only — the joints already account for it (see jointsOf). */
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
 * carries mirrored joints (see {@link mirrorPiece}), so honouring the flag here
 * as well would mirror twice. That is the one rule that keeps this and
 * {@link placeOnChord} exact inverses.
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
 * The inverse of {@link jointsOf}, and the same mapping the cave walk's
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
