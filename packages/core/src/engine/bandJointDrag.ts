// Editing a cave band — the one seam the solver lands on.
//
// A band is not a spine with stones fitted along it: it is a run of placed rock
// pieces whose chords the kit can actually build (14 lengths, turns of 0/±90).
// So a joint drag cannot be an offset the way a wall stone's is. It edits the
// floor outline the band was walked over and re-walks the affected stretch,
// which is the generator's own behaviour applied locally.
//
// Nothing is written to the store while the gesture is in flight. Not a style
// choice: a contour write re-unions the map's floor (subscribeToStore's merged
// floor subscriber, ~280ms on a dressed cave), so a live-writing drag would
// stutter at about two frames a second. The preview is overlay-only — ghost
// sprites over faded rock (bandGhostPreview) — and the whole gesture lands as
// one command on release.

import { caveBandPieces } from '../assets/caveWallKit';
import { useStore } from '../store/store';
import type { BandDragStatus, DungeonLayer } from '../store/types';
import { undoManager } from '../store/undoManager';
import {
  bandFloorRefusal,
  buildBandCommit,
  floorRingForBand,
  sameBand,
  sameRing,
  type BandFloor,
} from './bandCommit';
import { clearBandGhosts, showBandGhosts } from './bandGhostPreview';
import {
  bandJointPoint,
  rewalkBand,
  solveBandDrag,
  solveBandStraighten,
  type BandSolveResult,
} from './bandSolver';
import { detectBands, type CaveBand, type Vec } from './caveBand';
import { blockedLayerReason } from './tools/layerGuard';
import {
  bandJointIndex,
  bandJointT,
  bandRunIndex,
  setBandTransientT,
  type EditableRun,
} from './wallNodeOverlay';

type BandRun = EditableRun & { kind: 'band' };

export interface BandJointDrag {
  phase: 'begin' | 'move' | 'end' | 'cancel';
  /** The band in edit mode; absent once it can no longer resolve. */
  run?: BandRun | null;
  /** Synthetic joint `t`s the gesture moves — see `bandJointT`. */
  ts?: number[];
  /** World-unit delta since the last call. Zero outside `move`. */
  dx?: number;
  dy?: number;
}

/** What a gesture needs to remember between press and release. */
interface Session {
  layerId: string;
  /** The `<i>` of `band:<i>`. Positional, which is why release re-resolves it. */
  runIndex: number;
  floorId: string;
  ring: number;
  /** The ring as it stood at press — the solver's input, and the staleness check. */
  contour: Vec[];
  /** The band as it stood at press, likewise. */
  band: CaveBand;
  /** Index into the band's joints; fractional for a transient insert handle. */
  joint: number;
  origin: Vec;
  dx: number;
  dy: number;
  result: BandSolveResult | null;
}

let session: Session | null = null;

/** The map moved under a gesture between the solve and the commit. */
const STALE = 'the wall changed while that was being worked out — try again';

/**
 * How far the pointer has to travel, in cells, before a press counts as a drag.
 *
 * ponytail: a fixed 0.1 cells — two pixels at the default zoom, and a click that
 * wobbles is not a drag. The solver will happily answer one: a jitter of a pixel
 * re-lays five or six stones at a kit pull of 0.05 and pushes an undo entry for
 * a wall nobody can see move. Make it a screen-pixel threshold if a DM working
 * zoomed right out ever finds 0.1 cells too coarse to start a drag with.
 */
const MIN_DRAG = 0.1;

const status = (s: BandDragStatus | null): void => useStore.getState().setBandDragStatus(s);

/** The solver's answer, in the words the status bar shows. */
function report(result: BandSolveResult | null): void {
  if (!result) return status(null);
  status(
    result.ok
      ? { pieces: result.pieces.map((p) => p.piece.key), kitPull: result.kitPull }
      : { refusal: result.reason },
  );
}

/** The floor this band stands on, or the reason it cannot be edited. */
function floorFor(layer: DungeonLayer, band: CaveBand): BandFloor | string {
  const floor = floorRingForBand(layer, band);
  return bandFloorRefusal(floor) ?? floor!;
}

/**
 * Land a solution, having first checked the map is still the one it was solved
 * against.
 *
 * `band:<i>` is positional and the run is re-derived from the children every
 * time it is read, so anything that touched the layer between press and release
 * — another window, an autosave repair, an undo — can put a different band under
 * the same id. The solution names child ids and contour points; if either has
 * moved, the honest answer is to drop the gesture rather than write half of it.
 */
function commit(s: {
  layerId: string;
  runIndex: number;
  floorId: string;
  ring: number;
  contour: Vec[];
  band: CaveBand;
  result: BandSolveResult;
  label: string;
}): boolean {
  if (!s.result.ok) return false;
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === s.layerId,
  );
  if (!layer || blockedLayerReason(layer)) return false;

  const live = detectBands(layer)[s.runIndex];
  if (!live || !sameBand(live, s.band)) return false;
  const floor = layer.children.find((c) => c.id === s.floorId);
  if (!floor || floor.childType !== 'shape' || !sameRing(floor.contours[s.ring], s.contour)) {
    return false;
  }

  const command = buildBandCommit({
    layerId: layer.id,
    children: layer.children,
    floor: { id: floor.id, contours: floor.contours, ring: s.ring },
    band: s.band,
    solution: s.result,
    label: s.label,
  });
  if (!command) return false;
  undoManager.execute(command);
  return true;
}

/**
 * Re-key the selection onto the band the commit actually landed.
 *
 * A joint's synthetic `t` is `index / joints.length`, and a re-lay moves the
 * joint count — half the Warren's half-cell drags do — so the `t` that named the
 * dragged joint decodes against the NEW band to a fraction. That reads as a
 * transient insert handle a cell or two off the joint the DM is looking at:
 * Delete means "drop the handle" instead of "straighten", and the next drag runs
 * the fractional path. The one thing that survives a re-lay is where the gesture
 * landed on the map, so the primary is re-derived from that.
 *
 * The group goes with it. Every `t` in it is stale the same way, re-keying a set
 * risks two of them collapsing onto one joint, and `selectNode` clears it in the
 * same write. Showing the DM the group again is a follow-up, not this.
 */
function reselect(layerId: string, runIndex: number, near: Vec | null): void {
  // Whatever this lands on is a joint the walk actually laid, so any insert
  // handle the gesture started from is over.
  setBandTransientT(null);
  const store = useStore.getState();
  const layer = near
    ? store.layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId)
    : undefined;
  const joints = layer ? (detectBands(layer)[runIndex]?.joints ?? []) : [];
  if (!joints.length) return store.selectNode(null);
  const near2 = (p: Vec): number => (p[0] - near![0]) ** 2 + (p[1] - near![1]) ** 2;
  let best = 0;
  for (let m = 1; m < joints.length; m++) if (near2(joints[m]) < near2(joints[best])) best = m;
  store.selectNode(bandJointT(best, joints.length));
}

/**
 * Solve, then commit, for the gestures that have no drag behind them.
 *
 * A refusal leaves the band exactly as it was and puts its reason in the status
 * bar, which is the same contract the drag keeps. Answers whether anything
 * landed — the caller keeps the DM pointing at the joint a refusal is about.
 *
 * @param near Where the DM was pointing, for the selection to be re-keyed onto
 *   once the joints have been re-derived. Null re-keys onto nothing, which is
 *   the honest answer when every joint on the wall has just been re-laid.
 */
function runGesture(
  run: BandRun,
  label: string,
  near: Vec | null,
  solve: (floor: BandFloor) => BandSolveResult,
): boolean {
  const floor = floorFor(run.layer, run.band);
  if (typeof floor === 'string') {
    status({ refusal: floor });
    return false;
  }
  const contour = floor.child.contours[floor.ring].map((p): Vec => [p[0], p[1]]);
  const result = solve(floor);
  if (!result.ok) {
    report(result);
    return false;
  }
  const index = bandRunIndex(run.id);
  const landed =
    index !== null &&
    commit({
      layerId: run.layer.id,
      runIndex: index,
      floorId: floor.child.id,
      ring: floor.ring,
      contour,
      band: run.band,
      result,
      label,
    });
  status(landed ? null : { refusal: STALE });
  if (landed && index !== null) reselect(run.layer.id, index, near);
  return landed;
}

/**
 * Every phase of a band-joint drag, in one place.
 *
 * The gesture is previewed and nothing else: no store write, no command, no
 * change to the selection the caller already made, until `end` lands the one
 * composite. Cancel has nothing to rewind for exactly that reason.
 */
export function bandJointDrag(drag: BandJointDrag): void {
  switch (drag.phase) {
    case 'begin':
      return begin(drag.run ?? null, drag.ts ?? []);
    case 'move':
      return move(drag.dx ?? 0, drag.dy ?? 0);
    case 'end':
      return end();
    default:
      // Only the session's own status is cleared. A `begin` that never opened
      // one left a refusal behind — the reason the gesture is going nowhere —
      // and wiping that on the pointer-up would hide the only answer the DM got.
      if (session) status(null);
      session = null;
      clearBandGhosts();
  }
}

function begin(run: BandRun | null, ts: number[]): void {
  session = null;
  clearBandGhosts();
  status(null);
  if (!run) return;

  // The primary joint, and only the primary. A multi-joint solve is a different
  // deformation — several peaks over one stretch — and it is not built; dragging
  // the whole selection by one joint's answer would move handles the DM can see
  // are not where the cursor went.
  const primary = useStore.getState().tools.selectedNodeT ?? ts[0];
  if (primary === undefined || primary === null) return;
  const joint = bandJointIndex(primary, run.band.joints.length);
  if (joint < 0 || joint >= run.band.joints.length) return;

  const floor = floorFor(run.layer, run.band);
  if (typeof floor === 'string') return status({ refusal: floor });
  const index = bandRunIndex(run.id);
  if (index === null) return;

  session = {
    layerId: run.layer.id,
    runIndex: index,
    floorId: floor.child.id,
    ring: floor.ring,
    contour: floor.child.contours[floor.ring].map((p): Vec => [p[0], p[1]]),
    band: run.band,
    joint,
    // A whole index is the joint itself; a fraction is the transient handle
    // sitting in the span, and the drag is measured from where it is drawn.
    origin: bandJointPoint(run.band, joint),
    dx: 0,
    dy: 0,
    result: null,
  };
}

function move(dx: number, dy: number): void {
  if (!session) return;
  session.dx += dx;
  session.dy += dy;
  // Under the threshold there is nothing to solve, so `end` has nothing to land
  // and the gesture behaves as the click it was. Measured on the accumulated
  // delta rather than on this one move, so a slow drag still counts and a drag
  // that comes back to where it started stops counting again.
  if (Math.hypot(session.dx, session.dy) < MIN_DRAG) {
    if (!session.result) return;
    session.result = null;
    clearBandGhosts();
    return status(null);
  }
  // Solved from the ORIGIN plus the accumulated delta, never from the last
  // answer: the kit pulls the handle off the cursor by up to half a stone, and
  // chaining the solves would let that pull compound into a drift.
  //
  // ponytail: one solve per pointermove, unthrottled. Measured over all 127
  // joints of the Warren: p50 1.6ms, p99 7.6ms, worst 21ms on the few joints
  // that widen their anchors to the ±6 cap. The browser already coalesces
  // pointermove to about one a frame, so a rAF gate would only shave the
  // outliers — reach for one if a bigger cave makes the worst case the common
  // one.
  const to: Vec = [session.origin[0] + session.dx, session.origin[1] + session.dy];
  session.result = solveBandDrag({
    contour: session.contour,
    band: session.band,
    joint: session.joint,
    to,
    set: caveBandPieces(),
  });
  report(session.result);
  showBandGhosts(session.layerId, session.band, session.contour, session.result);
}

function end(): void {
  const s = session;
  session = null;
  clearBandGhosts();
  // A refusal from `begin` is the only answer the DM was given, so it outlives
  // the gesture that could not start.
  if (!s) return;
  if (!s.result?.ok) {
    // Same for a refusal from the walk: clearing the bar the instant the pointer
    // comes up would take the reason away exactly when it is read.
    report(s.result);
    return;
  }
  const landed = commit({ ...s, result: s.result, label: 'Move cave wall' });
  status(landed ? null : { refusal: STALE });
  // A refusal keeps the selection: the DM is still pointing at the span it is
  // about.
  if (!landed) return;
  // A transient insert handle is a selection and nothing else. Once the walk has
  // had its say the joints are whatever `detectBands` now finds, so the handle
  // that was never one of them goes away — it survives only as a seam the walk
  // actually laid.
  if (!Number.isInteger(s.joint)) {
    setBandTransientT(null);
    return useStore.getState().selectNode(null);
  }
  // A real joint keeps its handle, re-keyed onto whichever joint the walk put
  // where the drag ended. Its old `t` names a different joint — or no joint at
  // all — the moment the piece count moves.
  reselect(s.layerId, s.runIndex, [s.origin[0] + s.dx, s.origin[1] + s.dy]);
}

/**
 * Delete joints: the outline between the two surviving neighbours becomes a
 * straight chord, and that stretch is re-walked.
 *
 * How many pieces it ends up with falls out of the walk rather than being asked
 * for — which is what keeps the outline the single source of truth instead of
 * the children.
 */
export function straightenBandJoints(run: BandRun, ts: number[]): boolean {
  const n = run.band.joints.length;
  // A transient insert handle is not a joint: there is nothing there to
  // straighten between, and its fraction would send the solver to a joint that
  // does not exist.
  const joints = [...new Set(ts.map((t) => bandJointIndex(t, n)).filter(Number.isInteger))].sort(
    (a, b) => a - b,
  );
  if (!joints.length) return false;
  // The joints asked for are the ones going away, so the handle lands on
  // whichever joint survives nearest the primary. `selectedNodeTs` is unordered
  // and the store's primary may be a transient handle this gesture already
  // filtered out, so the lowest selected joint stands in for it.
  const t = useStore.getState().tools.selectedNodeT;
  const primary = t === null ? NaN : bandJointIndex(t, n);
  const near = bandJointPoint(run.band, joints.includes(primary) ? primary : joints[0]);
  return runGesture(run, 'Straighten cave wall', near, (floor) =>
    solveBandStraighten({
      contour: floor.child.contours[floor.ring] as Vec[],
      band: run.band,
      joints,
      set: caveBandPieces(),
    }),
  );
}

/**
 * Re-lay the whole wall over the outline as it stands now.
 *
 * The recovery tool for a band that has desynced from a floor shape moved by
 * other means. The outline is left exactly as it is — it is already what the DM
 * wants; the rock is what is wrong — so the piece count moves and the commit
 * carries the difference.
 */
export function rewalkWholeBand(run: BandRun): boolean {
  // Every joint on the wall is re-derived, so nothing that named one before
  // still does and there is no landing point to re-key onto: the selection goes.
  return runGesture(run, 'Re-lay cave wall', null, (floor) =>
    rewalkBand({
      contour: floor.child.contours[floor.ring] as Vec[],
      band: run.band,
      set: caveBandPieces(),
    }),
  );
}
