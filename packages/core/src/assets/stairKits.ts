// Stair kits: the straight flights of steps the installed packs declare (`StairsMeasure`), and a
// flight of stairs laid with one, piece by piece, by each piece's painted steps. A kit is every
// piece sharing its `kit`: one cell wide and two (Wide), running one cell and two. Pure but for
// the catalog it reads.

import { getStairsEntries } from './packCatalog';

type Vec = [number, number];

/** One straight piece of a kit: its entry, its size in cells, and its steps as painted. */
export interface StairPiece {
  entryId: string;
  wide: number;
  run: number;
  /** Cells from the tile's top-left: x0, y0, x1, y1. The top edge is the flight's high end. */
  painted: [number, number, number, number];
}

export interface StairKit {
  id: string;
  label: string;
  /** A stone kit's colour, matched against a cliff kit's name (`stairKitFor`). */
  colour?: string;
  /** The pack's own default kit. */
  default: boolean;
  pieces: StairPiece[];
}

/** A span's kit that stands for the stone kit of its cliff's colour. */
export const STONE_STAIRS = 'stone';

const memo = new WeakMap<object, StairKit[]>();

/** The stair kits the installed packs declare, in pack order, the default first. Kept per catalog. */
export function packStairKits(): readonly StairKit[] {
  const { entries, stamp } = getStairsEntries();
  const hit = memo.get(stamp);
  if (hit) return hit;
  const byId = new Map<string, StairKit>();
  for (const e of entries) {
    const s = e.stairs!;
    let kit = byId.get(s.kit);
    if (!kit) byId.set(s.kit, (kit = { id: s.kit, label: s.label, default: false, pieces: [], ...(s.colour && { colour: s.colour }) }));
    if (s.default) kit.default = true;
    if (s.wide > 0 && s.run > 0 && s.painted[2] > s.painted[0] && s.painted[3] > s.painted[1]) kit.pieces.push({ entryId: e.id, wide: s.wide, run: s.run, painted: s.painted });
  }
  const kits = [...byId.values()].filter((k) => k.pieces.length > 0).sort((a, b) => Number(b.default) - Number(a.default));
  memo.set(stamp, kits);
  return kits;
}

/** A kit by its id; null for one the installed packs do not declare. */
export function stairKitById(id: string | undefined): StairKit | null {
  return id ? (packStairKits().find((k) => k.id === id) ?? null) : null;
}

/**
 * The kit a flight is laid with: its own, else the packs' default. `stone` is the stone kit of the
 * cliff's colour (its colour named in `cliffArt`), else the first kit with a colour. Null with none.
 */
export function stairKitFor(kitId: string | undefined, cliffArt: string | undefined): StairKit | null {
  const kits = packStairKits();
  if (kitId === STONE_STAIRS) {
    const stone = kits.filter((k) => k.colour);
    const art = (cliffArt ?? '').toLowerCase();
    return stone.find((k) => art.includes(k.colour!.toLowerCase())) ?? stone[0] ?? null;
  }
  return stairKitById(kitId) ?? kits.find((k) => k.default) ?? kits[0] ?? null;
}

/** One piece of a flight as laid: its painted top-left on the map, turned and scaled. */
export interface LaidStair {
  entryId: string;
  painted: StairPiece['painted'];
  /** Where the painted steps' top-left corner lies, world cells. */
  origin: Vec;
  /** The tile's x axis on the map, radians: its y axis (down the flight) a quarter turn on. */
  rotation: number;
  /** World cells per tile cell across the flight and down it. */
  scale: Vec;
  /**
   * Whether the tile is cut off at its painted steps on its start side and its end side across the
   * flight: where it meets the next piece, its side line is trimmed (STAIR_SIDE_LINE inside
   * `painted`), so the two read as one flight.
   */
  crop: [boolean, boolean];
}

/** How far in from a piece's side its painted side line reaches, tile cells: trimmed where pieces meet. */
export const STAIR_SIDE_LINE = 0.015;

/**
 * How many times a flight's pieces are drawn over each other: a translucent overlay kit (one with
 * no stone colour) twice, so its steps read on a light floor at normal zoom; a stone kit once.
 */
export function stairPasses(kit: StairKit): number {
  return kit.colour ? 1 : 2;
}

/** Cell counts `total` is split into, by the sizes there are pieces for: the largest first. */
function slots(total: number, sizes: number[]): number[] {
  const out: number[] = [];
  let left = total;
  for (const s of [...sizes].sort((a, b) => b - a)) {
    while (left >= s) {
      out.push(s);
      left -= s;
    }
  }
  return out;
}

/**
 * A flight laid with `kit`: its top on the span `top`, running `length` cells along `down`. Across
 * it the pieces two cells wide come first and a one-cell piece takes what is left; down it the
 * longest run first, each piece's top at the foot of the one above. Each piece is laid by its
 * painted steps, scaled to its share of the span and the length (a whole number of cells takes
 * them at their own size). Listed foot first, so each piece's shading falls over the one below.
 */
export function layFlight(flight: { top: [Vec, Vec]; down: Vec; length: number }, kit: StairKit): LaidStair[] {
  const [a, b] = flight.top;
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (width < 1e-6 || flight.length <= 0) return [];
  const d = flight.down;
  // The tile's x axis: its y axis (down the flight) turned back a quarter, as a tile's axes are.
  const x: Vec = [d[1], -d[0]];
  const start = (b[0] - a[0]) * x[0] + (b[1] - a[1]) * x[1] >= 0 ? a : b;
  const cells = Math.max(1, Math.round(width));
  const across = slots(cells, [...new Set(kit.pieces.map((p) => p.wide))]);
  const down = slots(Math.max(1, Math.round(flight.length)), [...new Set(kit.pieces.map((p) => p.run))]);
  const sx = width / Math.max(1, Math.round(width));
  const sy = flight.length / Math.max(1, Math.round(flight.length));
  const rotation = Math.atan2(x[1], x[0]);
  const pick = (wide: number, run: number): StairPiece | undefined =>
    kit.pieces.find((p) => p.wide === wide && p.run === run) ?? kit.pieces.find((p) => p.run === run);
  const out: LaidStair[] = [];
  let along = 0;
  const rows: { at: number; run: number }[] = down.map((run) => {
    const row = { at: along, run };
    along += run;
    return row;
  });
  for (const row of rows.reverse()) {
    let off = 0;
    for (const wide of across) {
      const piece = pick(wide, row.run);
      const w = piece ? Math.min(wide, piece.wide) : wide;
      const reps = piece ? Math.max(1, Math.round(wide / w)) : 0;
      for (let r = 0; r < reps; r++) {
        // Where it meets a piece beside it, its side line is trimmed off.
        const crop: [boolean, boolean] = [off + r * w > 0, off + (r + 1) * w < cells];
        const [x0, y0, x1, y1] = piece!.painted;
        const painted: StairPiece['painted'] = [x0 + (crop[0] ? STAIR_SIDE_LINE : 0), y0, x1 - (crop[1] ? STAIR_SIDE_LINE : 0), y1];
        const o0 = (off + r * w) * sx;
        const t0 = row.at * sy;
        out.push({
          entryId: piece!.entryId,
          painted,
          origin: [start[0] + x[0] * o0 + d[0] * t0, start[1] + x[1] * o0 + d[1] * t0],
          rotation,
          scale: [(w * sx) / (painted[2] - painted[0]), (row.run * sy) / (y1 - y0)],
          crop,
        });
      }
      off += wide;
    }
  }
  return out;
}
