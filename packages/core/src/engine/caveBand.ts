// Finding the cave walls a map already has.
//
// A cave wall is not a WallSegment and not a floor ring: it is a run of ordinary
// asset children, one per rock piece, laid end to end so each piece's butt joints
// meet its neighbours' (see scripts/gen-goblin-warren.mjs). Nothing in the saved
// map records that they belong together — the run has to be recovered from where
// the joints landed, which is what this module does. Everything downstream (node
// handles, the joint solver) works on the band, not on the children.
//
// Pure geometry: no Pixi, no store.

import {
  isCaveBandAsset,
  jointsOf,
  pieceForAsset,
  type CaveKitPiece,
  type KitPlacement,
} from '../assets/caveWallKit';
import type { DungeonLayer } from '../store/types';

export type Vec = [number, number];

export interface BandPiece {
  childId: string;
  piece: CaveKitPiece;
  at: KitPlacement;
  /** World joints, start then end, walking the band forwards. */
  joints: [Vec, Vec];
}

export interface CaveBand {
  pieces: BandPiece[];
  /**
   * One joint per seam, in walk order. A closed band has as many joints as
   * pieces; an open run has one more, because both free ends count.
   */
  joints: Vec[];
  closed: boolean;
}

/**
 * How far apart two joints may sit and still be the same seam, in cells.
 *
 * Measured on the Warren: the widest correct seam is 0.555 and the nearest wrong
 * successor 0.578, so the honest threshold is somewhere in between and the
 * matching below is what keeps that 0.023-cell margin from mattering. 1.2 is
 * deliberately loose — a hand-placed piece is allowed to be sloppy, and a loose
 * threshold only adds CANDIDATES, never wrong answers, because one-to-one
 * matching still spends each end on its closest partner first.
 */
const MAX_SEAM = 1.2;

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Every run of kit pieces on the layer, walked end to end. */
export function detectBands(layer: DungeonLayer): CaveBand[] {
  const pieces: BandPiece[] = [];
  for (const child of layer.children) {
    if (child.childType !== 'asset' || !isCaveBandAsset(child.assetId)) continue;
    // Through pieceForAsset, never by pairing a base piece with the child's
    // flipY by hand: a mirrored straight carries mirrored joints, so applying
    // the flip again here would put every joint on the wrong side of the run.
    const piece = pieceForAsset(child.assetId, child.flipY);
    if (!piece) continue;
    pieces.push({ childId: child.id, piece, at: child, joints: jointsOf(piece, child) });
  }

  // Global one-to-one matching, not per-node nearest. Nearest agrees on the
  // shipped map by 0.023 cells and disagreed on nine seams of the same map a fix
  // ago; matching cannot double-assign, so a band a DM has dragged out of shape
  // still walks. Deliberately no turn or forward-direction gate: both were
  // measured and both made it worse, because a real successor across a 90° bend
  // fails a forward test and a hairpin fails a turn cap.
  // ponytail: O(n²) over band children (127 on the Warren). Grid the ends if a
  // map ever carries thousands.
  const succ = new Array<number>(pieces.length).fill(-1);
  const pred = new Array<number>(pieces.length).fill(-1);
  const candidates: [gap: number, from: number, to: number][] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let k = 0; k < pieces.length; k++) {
      if (i === k) continue;
      const gap = dist(pieces[i].joints[1], pieces[k].joints[0]);
      if (gap <= MAX_SEAM) candidates.push([gap, i, k]);
    }
  }
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [, from, to] of candidates) {
    if (succ[from] < 0 && pred[to] < 0) {
      succ[from] = to;
      pred[to] = from;
    }
  }

  // Heads first, so an open run is walked from its free end rather than picked
  // up in the middle; whatever is left over is a cycle.
  const seen = new Set<number>();
  const starts = [...pieces.keys()].filter((i) => pred[i] < 0).concat([...pieces.keys()]);
  const bands: CaveBand[] = [];
  for (const start of starts) {
    if (seen.has(start)) continue;
    const run: BandPiece[] = [];
    let cur = start;
    while (cur >= 0 && !seen.has(cur)) {
      seen.add(cur);
      run.push(pieces[cur]);
      cur = succ[cur];
    }
    bands.push(bandOf(run, cur === start));
  }
  return bands;
}

function bandOf(pieces: BandPiece[], closed: boolean): CaveBand {
  // A seam is the MIDPOINT of the two joints that meet there, not either of
  // them: the generator overlaps consecutive pieces by BAND_OVERLAP (0.30
  // cells) so no light shows between them, and the midpoint is where the wall
  // actually reads as turning over.
  const joints: Vec[] = [];
  if (!closed) joints.push(pieces[0].joints[0]);
  for (let m = 0; m < pieces.length - (closed ? 0 : 1); m++) {
    joints.push(mid(pieces[m].joints[1], pieces[(m + 1) % pieces.length].joints[0]));
  }
  if (!closed) joints.push(pieces[pieces.length - 1].joints[1]);
  return { pieces, joints, closed };
}
