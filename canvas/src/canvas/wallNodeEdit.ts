import { useStore } from '@/store/store';
import { UpdateWallCommand, UpdateFloorWallEditsCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import {
  mergeNodeEdit,
  mergeSpanEdit,
  layoutWall,
  applyWallEdits,
  isClosedSpine,
  type WallNode,
} from '@/engine/wallLayout';
import { seedForPoints } from '@/engine/wallNodeRenderer';
import {
  currentWallNodes,
  activeEditableRun,
  floorRingIndex,
  bandJointIndex,
  bandJointT,
  bandRunAt,
  bandRunIndex,
  setBandTransientT,
  noWallStonesReason,
  runSetSpecs,
  wallRunSetId,
  spineCornerIndex,
  spineWallId,
  FLOOR_WALL_PREFIX,
  SPINE_WALL_PREFIX,
  type EditableRun,
} from '@/engine/wallNodeOverlay';
import { bandJointDrag, rewalkWholeBand, straightenBandJoints } from '@/engine/bandJointDrag';
import {
  beginRingStoneDrag,
  updateRingStoneDrag,
  endRingStoneDrag,
  cancelRingStoneDrag,
  isDraggingRingStone,
} from '@/engine/ringStoneDrag';
import { isBandSet } from '@dnd/core/src/assets/packCatalog';
import { toggleShapeNodeEditAt } from '@dnd/core/src/engine/shapeNodeEdit';
import { ringLook, standaloneWallLook } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle, layerLevelLook } from '@dnd/core/src/engine/levelLook';
import { notify } from '@dnd/core/src/shared/notify';
import { snapToNearestWall } from '@/shared/wallSnap';
import { isLayerEffectivelyVisible } from '@/store/selectors';
import type { DungeonLayer } from '@/store/types';
import type { WallNodeEdit, WallNodeInsert, WallEdits } from '@/shared/types';
import type { Point } from '@/types/geometry';

/** Max distance, in world units, for a double-click to claim a wall. */
const PICK_RADIUS = 0.6;
/**
 * How far from its line a drawn cave wall is picked: its rock rides about a
 * cell into the void beside the line, and the double-click lands on the rock.
 */
const BAND_PICK_RADIUS = 1;

/**
 * Enter node-edit mode on the wall under the pointer, or leave it if that wall
 * is already being edited. Double-click on the wall itself rather than a panel
 * toggle: the thing being edited is the thing you point at.
 *
 * @returns True when the double-click was answered — the mode toggled on, or a
 *   wall was hit and the attempt refused with a reason — so the caller stops
 *   offering it to the outline editor.
 */
export function toggleNodeEditAt(world: Point): boolean {
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' &&
      l.id === state.ui.activeLayerId &&
      isLayerEffectivelyVisible(state, l) &&
      !l.locked,
  );
  if (!layer) return false;

  const hit = snapToNearestWall([world.x, world.y], layer.standaloneWalls, PICK_RADIUS);
  let id = hit?.wallId ?? null;
  // A drawn wall on a cave kit is reached from its rock, not just its line.
  const drawStyle = layerDrawStyle(layer);
  const bandWalls = layer.standaloneWalls.filter((w) => isBandSet(standaloneWallLook(w, drawStyle).setId));
  const bandWallHit = !id && bandWalls.length
    ? snapToNearestWall([world.x, world.y], bandWalls, BAND_PICK_RADIUS)
    : null;

  // Most walls on a finished map are derived from the floor outline rather than
  // drawn by hand. Their stones are composed the same way and are just as worth
  // adjusting, so fall through to the nearest ring. A cave kit's rock reaches
  // about a cell past the edge it rides, so a ring drawn with one is picked
  // from that far.
  if (!id && layer.mergedFloor) {
    const level = layerLevelLook(layer);
    const anyBand = layer.mergedFloor.some((_, i) => isBandSet(ringLook(layer, i, level).setId));
    const reach = Math.max(PICK_RADIUS, drawStyle.wallWidth, anyBand ? 1 : 0);
    const rings = layer.mergedFloor.map((points, i) => ({
      id: `${FLOOR_WALL_PREFIX}${i}`,
      points,
      // Rings are closed; snapToNearestWall walks a polyline, so repeat the
      // first point to include the closing edge.
      closed: [...points, points[0]],
    }));
    const ringHit = snapToNearestWall(
      [world.x, world.y],
      rings.map((r) => ({
        id: r.id,
        points: r.closed,
        wallType: 'normal' as const,
        direction: 'both' as const,
        color: '#000000',
        width: 1,
        roughness: 0,
      })),
      reach,
    );
    id = ringHit?.wallId ?? null;
    // The nearer of the two: a drawn cave wall's rock and a floor edge's can
    // both be within a cell of the double-click.
    if (bandWallHit && (!ringHit || bandWallHit.distance <= ringHit.distance)) id = bandWallHit.wallId;
  } else if (!id && bandWallHit) {
    id = bandWallHit.wallId;
  }

  // A cave layer's walls are placed rock, not wall-set stones, so nothing above
  // can claim them: `snapToNearestWall` finds the sight geometry or the floor
  // ring under the band, and both would be refused for want of a texture set.
  // Asked only when the stone path has nothing to offer, so a layer that does
  // carry a wall set behaves exactly as it did.
  const bandId = noWallStonesReason(layer)
    ? bandRunAt(layer, world, Math.max(PICK_RADIUS, drawStyle.wallWidth))
    : null;
  if (bandId) id = bandId;

  // A drawn wall on a cave kit has no stones: its rock is walked along the
  // wall's own line on every redraw. Its editor is that line's corners (see
  // SPINE_WALL_PREFIX) — not the floor outline, which is a different wall.
  if (id && !bandId && floorRingIndex(id) === null && isBandSet(wallRunSetId(layer, id))) {
    id = `${SPINE_WALL_PREFIX}${id}`;
  }

  const next = id && id !== state.tools.nodeEditWallId ? id : null;
  // A wall was aimed at but this layer has no stones to show — refuse here,
  // with the reason, rather than dim the map into a mode holding no handles.
  // The check reads the set the hit resolved to, the same one `activeWall`
  // would compose its stones from, so a refusal and an empty run never
  // disagree. Claiming the double-click
  // (true) rather than falling through keeps the answer to "edit this wall"
  // from being an outline editor the DM did not ask for.
  if (next && !bandId && spineWallId(next) === null) {
    // The set the hit wall is actually drawn with: a preset may have pinned a
    // floor or a drawn wall to a set other than the layer's.
    const setId = wallRunSetId(layer, next);
    const reason = noWallStonesReason(layer, setId);
    if (reason) {
      // A cave kit's rock is laid from the floor outline on every redraw, so
      // the outline editor IS its node mode: say so and let the double-click
      // fall through to it rather than stopping at a warning.
      if (isBandSet(setId)) {
        notify.info(reason);
        // The rock reaches about a cell into the void past the edge it rides,
        // so the outline is picked by nearness rather than containment.
        return toggleShapeNodeEditAt(world, 1);
      }
      notify.warning(reason);
      return true;
    }
  }
  state.setNodeEditWall(next);
  return next !== null;
}

export function exitNodeEdit(): void {
  if (useStore.getState().tools.nodeEditWallId) {
    useStore.getState().setNodeEditWall(null);
  }
}

/**
 * Write a patch to whichever kind of run is in edit mode.
 *
 * A standalone wall stores its edits on its own WallSegment; a floor-derived
 * ring has no such object — it is recomputed from the shapes on every change —
 * so its edits sit on the layer, keyed by ring index. Both go through one
 * command each, so undo works the same either way.
 */
function writeEdits(patch: Partial<WallEdits>): void {
  const run = activeEditableRun();
  // A band has no WallEdits to patch — its pieces are real children, and moving
  // one is the solver's job; a drawn cave wall's only edit is its line. One
  // guard here covers the whole keyboard table, which all routes through this.
  if (!run || run.kind !== 'stones') return;
  const before: WallEdits = {
    nodeEdits: run.edits?.nodeEdits,
    spanEdits: run.edits?.spanEdits,
    nodeInserts: run.edits?.nodeInserts,
  };
  commitEdits(run, before, { ...before, ...patch });
}

/**
 * Write one before/after pair of edit lists as a single undoable step, giving
 * any stone the change derives a record of its own first.
 */
function commitEdits(run: EditableRun, before: WallEdits, after: WallEdits): void {
  const settled = { ...after, nodeInserts: materialisedInserts(run, after) };
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    // `run.edits`, not the spelled-out `before`: a ring with no edits at all
    // must undo back to having none rather than to an empty husk of a record.
    undoManager.execute(
      new UpdateFloorWallEditsCommand(run.layer.id, String(ring), run.edits, settled),
    );
    return;
  }
  undoManager.execute(new UpdateWallCommand(run.layer.id, run.id, before, settled));
}

/**
 * Persist the stones an edit derived, so each one becomes a node in its own
 * right.
 *
 * `fillNodeGaps` bridges a seam an edit tore open by cloning the leading stone.
 * Those clones are recomputed every frame and have no record behind them, so
 * every hand edit aimed at one fell through to the stone it was cloned from —
 * Tab on any of them swapped the donor, and the whole run of bridge stones
 * changed together. Writing them out as ordinary inserts gives each its own `t`,
 * which is the anchor every edit is keyed to.
 *
 * Rotation is measured rather than derived: an insert's angle is interpolated
 * from its neighbours, so the correction is whatever closes the gap between that
 * and the angle the bridge was actually drawn at. Re-running the layout to read
 * it back keeps this honest if the interpolation rule ever changes.
 */
function materialisedInserts(run: EditableRun, edits: WallEdits): WallNodeInsert[] | undefined {
  const pieces = runSetSpecs(run);
  if (pieces.length === 0) return edits.nodeInserts;

  const fill = { pieces, wallWidth: run.width };
  const lay = (e: WallEdits): WallNode[] =>
    applyWallEdits(
      layoutWall(run.points, run.closed, pieces, {
        wallWidth: run.width,
        seed: seedForPoints(run.points),
      }),
      e,
      undefined,
      fill,
    );

  const known = edits.nodeInserts ?? [];
  const derived = lay(edits).filter(
    (n) => n.kind === 'inserted' && !known.some((i) => Math.abs(i.t - n.t) < 1e-9),
  );
  if (derived.length === 0) return edits.nodeInserts;

  const withNew: WallEdits = {
    ...edits,
    nodeInserts: [
      ...known,
      ...derived.map((n) => ({ t: n.t, pieceId: n.pieceId, scale: n.sizeScale })),
    ],
  };
  // Second pass: the inserts are in place now, so any angle they came out at
  // that differs from the bridge's own is exactly the rotation to store.
  const placed = lay(withNew);
  return withNew.nodeInserts!.map((ins) => {
    const want = derived.find((n) => Math.abs(n.t - ins.t) < 1e-9);
    if (!want) return ins;
    const got = placed.find((n) => n.kind === 'inserted' && Math.abs(n.t - ins.t) < 1e-9);
    if (!got) return ins;
    const rotate = Math.atan2(Math.sin(want.angle - got.angle), Math.cos(want.angle - got.angle));
    return Math.abs(rotate) < 1e-6 ? ins : { ...ins, rotate };
  });
}

/**
 * Apply one manual adjustment to a node of the run in edit mode.
 *
 * An edit is only ever a patch to the run's `nodeEdits` array, so node editing
 * inherits undo for free.
 */
export function editWallNode(edit: WallNodeEdit): void {
  const run = activeEditableRun();
  if (!run) return;
  writeEdits({ nodeEdits: mergeNodeEdit(run.edits?.nodeEdits, edit) });
  reselectNear(edit.t);
}

/**
 * Keep the selection glued to the stone it was on.
 *
 * Editing relays the run, which shifts every `t` slightly. Leaving the stored
 * `selectedNodeT` behind meant a second keypress landed on a *neighbouring*
 * stone — and once it drifted past the last one, handleNodeKey stopped claiming
 * the key and it fell through to the global shortcuts, so holding `=` zoomed
 * the canvas instead of growing the stone.
 */
function reselectNear(t: number): void {
  const nodes = currentWallNodes();
  if (nodes.length === 0) return;
  let best = nodes[0];
  for (const n of nodes) {
    if (Math.abs(n.t - t) < Math.abs(best.t - t)) best = n;
  }
  useStore.getState().selectNode(best.t);
}

/** Per keypress. Small enough to nudge, large enough to be worth a press. */
const ROTATE_STEP = (5 * Math.PI) / 180;
const SCALE_STEP = 1.1;
/** Seam adjustment per keypress, in world units. */
const GAP_STEP = 0.05;

/** Widen or tighten the seam after the selected node. */
function adjustSpan(t: number, gap: number): void {
  const run = activeEditableRun();
  if (!run) return;
  writeEdits({ spanEdits: mergeSpanEdit(run.edits?.spanEdits, { t, gap }) });
  reselectNear(t);
}

/**
 * Drop an extra stone just before or after the selected one.
 *
 * Offset by a hair of the spine rather than exactly on the neighbour's `t`, so
 * the new stone gets its own edit anchor instead of colliding with one that is
 * already there.
 */
function insertStone(t: number, direction: -1 | 1): void {
  const run = activeEditableRun();
  if (!run) return;
  const nodes = currentWallNodes();
  const node = nodes.find((n) => Math.abs(n.t - t) < 1e-9);
  if (!node) return;

  // Halfway to the neighbour on that side, so it lands in the seam rather than
  // on top of a stone.
  const sorted = [...nodes].sort((a, b) => a.t - b.t);
  const i = sorted.findIndex((n) => Math.abs(n.t - t) < 1e-9);
  const neighbour = sorted[i + direction];
  const at = neighbour ? (node.t + neighbour.t) / 2 : node.t + direction * 0.005;
  const clamped = Math.min(Math.max(at, 0), 1);

  writeEdits({
    nodeInserts: [...(run.edits?.nodeInserts ?? []), { t: clamped, pieceId: node.pieceId }],
  });
  // Select the stone just added, so it can be rotated or resized straight away.
  reselectNear(clamped);
}

/**
 * Swap the piece under the selected node for the next one the set offers.
 *
 * Cycles within the node's own role: a run stone swaps among the set's
 * straights and rocks, a cornerstone among its corner variants, an end cap
 * among its endings. Roles never cross — a corner mid-run reads as a mistake,
 * which is why the pool is scoped to what can actually stand in.
 */
function cyclePiece(t: number, direction: number): void {
  const run = activeEditableRun();
  if (!run) return;

  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' &&
      l.id === state.ui.activeLayerId &&
      isLayerEffectivelyVisible(state, l) &&
      !l.locked,
  );
  if (!layer || layer.id !== run.layer.id) return;

  const node = currentWallNodes().find((n) => Math.abs(n.t - t) < 1e-9);
  if (!node) return;

  // The run's own set: a wall a preset pinned swaps among the pieces it is drawn with.
  const specs = runSetSpecs(run);
  const role = specs.find((p) => p.id === node.pieceId)?.role;
  const swappable = specs.filter(
    role === 'corner' || role === 'ending'
      ? (p) => p.role === role
      : (p) => p.role === 'straight' || p.role === 'rock',
  );
  if (swappable.length < 2) return;

  const at = swappable.findIndex((p) => p.id === node.pieceId);
  const next = swappable[(at + direction + swappable.length) % swappable.length];

  writeEdits({ nodeEdits: mergeNodeEdit(run.edits?.nodeEdits, { t, pieceId: next.id }) });
}

/**
 * Drop a transient handle in the span on one side of the selected joint.
 *
 * The band's answer to {@link insertStone}, on the same keys. A joint cannot
 * simply be added the way a stone can: what a cave wall can be is whatever the
 * kit can build, so the handle is nothing but a selection — no store write, no
 * command, no change to the band — and dragging it runs the ordinary solver with
 * the deformation peaked there. The walk decides whether a seam really lands at
 * that point, which is what keeps the outline the source of truth. Deselect it,
 * or leave the mode, and it is gone.
 */
function insertBandJoint(t: number, direction: -1 | 1): void {
  const run = activeEditableRun();
  if (run?.kind !== 'band') return;
  const n = run.band.joints.length;
  const from = bandJointIndex(t, n);
  // Already a transient handle: there is no span between it and a joint to put
  // another one in, and one at a time is the whole feature.
  if (!Number.isInteger(from)) return;
  // Halfway to the neighbour on that side, so it lands in the middle of a span
  // rather than on top of a joint — the same rule insertStone follows.
  const at = from + direction * 0.5;
  // An open run has no span past its free ends.
  if (!run.band.closed && (at <= 0 || at >= n - 1)) return;
  const handle = bandJointT(run.band.closed ? ((at % n) + n) % n : at, n);
  // The gesture is what makes a handle transient, not the fraction it happens to
  // land on: a `t` keyed to a joint count that has since moved is fractional
  // too, and reading that as a handle is what broke Delete after an undo.
  setBandTransientT(handle);
  useStore.getState().selectNode(handle);
}

/**
 * The band's own keyboard table.
 *
 * Three entries, because a band has three things a DM can ask of it that the
 * drag cannot: drop a handle mid-span to drag from ({@link insertBandJoint}),
 * take a joint out (the outline between its neighbours becomes a straight chord
 * and that stretch is re-walked), and re-lay the whole wall over the outline as
 * it stands — the recovery tool for a band that has drifted from a floor moved
 * by other means.
 *
 * Tab is the re-lay for the same reason it cycles a stone's piece in the other
 * table: in both, Tab means "let the set choose again". All of them claim their
 * key even when the run has gone unresolvable, so Delete can never fall through
 * to the global binding and take the shape selection with it.
 */
function handleBandKey(key: string, t: number): boolean {
  if (key === '{' || key === '}') {
    insertBandJoint(t, key === '{' ? -1 : 1);
    return true;
  }
  if (key !== 'Tab' && key !== 'Delete' && key !== 'Backspace') return false;
  const run = activeEditableRun();
  if (run?.kind !== 'band') return true;
  // Delete on a transient handle just takes the handle away again: nothing was
  // written for it, and there is no joint there to straighten between.
  if (key !== 'Tab' && !Number.isInteger(bandJointIndex(t, run.band.joints.length))) {
    setBandTransientT(null);
    useStore.getState().selectNode(null);
    return true;
  }
  const ts = useStore.getState().tools.selectedNodeTs;
  // Either gesture re-derives the joints, so a synthetic `t` from before it no
  // longer names the handle it did. Landing one re-keys the selection itself —
  // a straighten onto the joint that survived nearest the one taken out, a
  // whole-wall re-lay onto nothing — and a refusal leaves it alone, so the DM is
  // still pointing at the joint the refusal is about.
  if (key === 'Tab') rewalkWholeBand(run);
  else straightenBandJoints(run, ts.length ? ts : [t]);
  return true;
}

/**
 * Keyboard adjustments for the selected node.
 *
 * Returns true when the key was consumed, so the caller can stop it reaching
 * the global shortcut table — Delete is already bound there to removing the
 * shape selection, and with a node selected it must mean this node.
 */
/**
 * A drawn cave wall's table: Delete takes the selected corner out of its line.
 * Every other session key is swallowed — there are no stones to turn or swap.
 */
function handleSpineKey(key: string, t: number): boolean {
  if (key !== 'Delete' && key !== 'Backspace') return true;
  const run = activeEditableRun();
  if (run?.kind !== 'spine') return true;
  const pts = run.wall.points;
  const closed = run.closed;
  const corners = closed ? pts.slice(0, -1) : pts;
  // An open line needs two corners, a loop three.
  if (corners.length <= (closed ? 3 : 2)) {
    notify.info('A wall needs at least ' + (closed ? 'three corners to loop' : 'two ends'));
    return true;
  }
  const at = spineCornerIndex(t, pts);
  const kept = corners.filter((_, i) => i !== at);
  const after = closed ? [...kept, kept[0]] : kept;
  undoManager.execute(
    new UpdateWallCommand(run.layer.id, run.wall.id, { points: pts }, { points: after }),
  );
  useStore.getState().selectNode(null);
  return true;
}

export function handleNodeKey(key: string, t: number): boolean {
  if (spineWallId(useStore.getState().tools.nodeEditWallId ?? '') !== null) {
    return handleSpineKey(key, t);
  }
  // A band has its own, much shorter table: the kit does the fitting, so there
  // is nothing to rotate, resize or swap. Routed off the wall id rather than by
  // resolving the run, so a stone keypress costs exactly what it did before.
  if (bandRunIndex(useStore.getState().tools.nodeEditWallId ?? '') !== null) {
    return handleBandKey(key, t);
  }
  switch (key) {
    case '[':
      editWallNode({ t, rotate: -ROTATE_STEP });
      return true;
    case ']':
      editWallNode({ t, rotate: ROTATE_STEP });
      return true;
    case '-':
    case '_':
      editWallNode({ t, scale: 1 / SCALE_STEP });
      return true;
    case '=':
    case '+':
      editWallNode({ t, scale: SCALE_STEP });
      return true;
    case ',':
    case '<':
      adjustSpan(t, -GAP_STEP);
      return true;
    case '.':
    case '>':
      adjustSpan(t, GAP_STEP);
      return true;
    case 'Tab':
      cyclePiece(t, 1);
      return true;
    // Add a stone on one side of this one. Bracket keys already rotate, so the
    // shifted pair sits next to them for "same axis, bigger effect".
    case '{':
      insertStone(t, -1);
      return true;
    case '}':
      insertStone(t, 1);
      return true;
    case 'Delete':
    case 'Backspace':
      editWallNode({ t, removed: true });
      // The node it pointed at no longer exists.
      useStore.getState().selectNode(null);
      return true;
    default:
      return false;
  }
}

// ─── Drag: one undo entry per gesture, not per frame ──────────────────
//
// A drag emits a pointermove every few pixels. Pushing a command per move made
// undo walk the gesture back a fraction at a time — five presses to reverse one
// small drag. So the drag writes straight to the store and a single command is
// recorded on release, from the state captured on press.

let dragBefore: WallNodeEdit[] | undefined;
let dragWallId: string | null = null;
/** A drawn cave wall's line at press, and the corners the drag moves. */
let spineBefore: [number, number][] | null = null;
let spineCorners: number[] = [];
/** The layer the drag began on — rewindDrag resolves against this, not
 *  whatever the active layer happens to be at cancel/release time. */
let dragLayerId: string | null = null;

/**
 * @param ts Stones the gesture will move. On a floor ring the drag is not a
 *   cosmetic offset at all — the stones stand on the outline, so it becomes an
 *   edit of the outline itself and these say which stretch of it moves.
 */
export function beginNodeDrag(ts: number[] = []): void {
  const run = activeEditableRun();
  if (!run) return;
  dragWallId = run.id;
  dragLayerId = run.layer.id;
  if (run.kind === 'band') {
    bandJointDrag({ phase: 'begin', run, ts });
    return;
  }
  if (run.kind === 'spine') {
    spineBefore = run.wall.points.map(([x, y]): [number, number] => [x, y]);
    spineCorners = [...new Set(ts.map((t) => spineCornerIndex(t, run.wall.points)))];
    return;
  }
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    beginRingStoneDrag(run.layer, ring, ts);
    return;
  }
  // Snapshot, not a reference — the store's copy is about to change underneath.
  dragBefore = run.edits?.nodeEdits?.map((e) => ({ ...e }));
}

/**
 * Live nudge during a drag. Deliberately bypasses the undo stack.
 *
 * Takes the whole selection rather than one node so a group move is one write:
 * merging them one at a time would read `run.edits` back from a store that the
 * previous merge in the same frame had already moved on from.
 */
export function nudgeWallNode(ts: number[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  if (isDraggingRingStone()) {
    updateRingStoneDrag(dx, dy);
    return;
  }
  if (ts.length === 0) return;
  const run = activeEditableRun();
  if (!run || floorRingIndex(run.id) !== null) return;
  if (run.kind === 'band') {
    bandJointDrag({ phase: 'move', run, ts, dx, dy });
    return;
  }
  if (run.kind === 'spine') {
    useStore.getState().updateWall(run.layer.id, run.wall.id, {
      points: movedCorners(run.wall.points, spineCorners, dx, dy),
    });
    return;
  }
  let nodeEdits = run.edits?.nodeEdits;
  for (const t of ts) nodeEdits = mergeNodeEdit(nodeEdits, { t, dx, dy });
  useStore.getState().updateWall(run.layer.id, run.id, { nodeEdits });
}

/**
 * A drawn wall's line with `corners` moved by (dx, dy). A loop's closing
 * point is its first corner, so the two move together.
 */
export function movedCorners(
  points: [number, number][],
  corners: number[],
  dx: number,
  dy: number,
): [number, number][] {
  const closed = isClosedSpine(points);
  const moving = new Set(corners);
  return points.map(([x, y], i): [number, number] => {
    const corner = closed && i === points.length - 1 ? 0 : i;
    return moving.has(corner) ? [x + dx, y + dy] : [x, y];
  });
}

/** True while a handle drag is in flight. */
export function isDraggingNode(): boolean {
  return dragWallId !== null;
}

/**
 * Put a standalone wall's live-written nodeEdits back to `before`.
 *
 * A rewind, not an edit: this has to succeed even if the layer went locked
 * or hidden mid-drag, or an edit made just before locking becomes stuck
 * with no way to undo it. So no lock/visible check here — only that the
 * layer still exists to write the rewind into.
 *
 * Resolves against the layer id the drag actually began on, not
 * `ui.activeLayerId`: switching the active layer mid-drag must not make the
 * rewind silently miss the layer the live nudge was written into.
 */
function rewindDrag(layerId: string, wallId: string, before: WallNodeEdit[] | undefined): void {
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId,
  );
  if (!layer) return;
  state.updateWall(layer.id, wallId, { nodeEdits: before });
}

/**
 * Abandon the gesture and put the run back the way it was.
 *
 * Needed because the drag writes straight to the store: leaving edit mode
 * mid-drag used to make endNodeDrag's `activeEditableRun()` return null, so it
 * recorded nothing and the half-finished move stuck with no undo entry for it.
 */
export function cancelNodeDrag(): void {
  const wallId = dragWallId;
  const layerId = dragLayerId;
  const before = dragBefore;
  dragWallId = null;
  dragLayerId = null;
  dragBefore = undefined;
  const spinePoints = spineBefore;
  spineBefore = null;
  spineCorners = [];
  if (wallId && bandRunIndex(wallId) !== null) {
    // Read off the id rather than a flag of its own: the seam wrote nothing, so
    // there is nothing to rewind and no state to keep in step with.
    bandJointDrag({ phase: 'cancel' });
    return;
  }
  const spineOf = wallId ? spineWallId(wallId) : null;
  if (spineOf !== null) {
    // Same rule as rewindDrag: put the line back on the layer the drag began
    // on, whatever has happened to it since.
    if (spinePoints && layerId) useStore.getState().updateWall(layerId, spineOf, { points: spinePoints });
    return;
  }
  if (isDraggingRingStone()) {
    cancelRingStoneDrag();
    return;
  }
  if (!wallId || !layerId) return;
  rewindDrag(layerId, wallId, before);
}

/** Record the whole gesture as one undoable step. */
export function endNodeDrag(): void {
  const wallId = dragWallId;
  const layerId = dragLayerId;
  dragWallId = null;
  dragLayerId = null;
  const before = dragBefore;
  dragBefore = undefined;
  const spinePoints = spineBefore;
  spineBefore = null;
  spineCorners = [];
  const spineOf = wallId ? spineWallId(wallId) : null;
  if (spineOf !== null) {
    if (!spinePoints || !layerId) return;
    const layer = useStore
      .getState()
      .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId);
    const after = layer?.standaloneWalls.find((w) => w.id === spineOf)?.points;
    if (!after || JSON.stringify(after) === JSON.stringify(spinePoints)) return;
    // Blocked mid-drag: put the line back rather than land an edit with no undo.
    if (!activeEditableRun()) {
      useStore.getState().updateWall(layerId, spineOf, { points: spinePoints });
      return;
    }
    // The store already holds `after`; execute() re-applying it is harmless,
    // and the command is what undo walks back.
    undoManager.execute(
      new UpdateWallCommand(layerId, spineOf, { points: spinePoints }, { points: after }),
    );
    return;
  }
  if (wallId && bandRunIndex(wallId) !== null) {
    // No re-resolve here: the session captured the layer, the floor child and
    // the band at press, and it re-resolves all three against the live store
    // itself before committing — see bandJointDrag. Reading the run again would
    // only cost another detectBands and warn about a layer that locked mid-drag.
    bandJointDrag({ phase: 'end' });
    return;
  }
  if (isDraggingRingStone()) {
    // Re-check here too: beginNodeDrag gated entry, but the layer can have
    // locked or hidden in the time between the last nudge and release. Ring
    // stones have no dx/dy of their own to rewind — the drag lives entirely
    // in the outline editor's own before/after — so blocked here means
    // cancelling that session instead of landing it.
    if (!activeEditableRun()) {
      cancelRingStoneDrag();
      return;
    }
    // The outline editor owns this gesture and lands it as one command of its
    // own — geometry and relaid stones together.
    endRingStoneDrag();
    return;
  }

  const run = activeEditableRun();
  if (!run || run.id !== wallId) {
    // Blocked mid-drag (the layer locked or hid, or the active layer switched
    // away, between the last nudge and pointer-up): the live nudge already
    // landed in the store with no undo entry behind it. Put it back rather
    // than leave it stuck.
    if (wallId && layerId) rewindDrag(layerId, wallId, before);
    return;
  }
  const after = run.edits?.nodeEdits;
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;

  // State already equals `after` bar the stones the drag derived; execute()
  // re-applying it is what writes those out.
  commitEdits(
    run,
    { nodeEdits: before, spanEdits: run.edits?.spanEdits, nodeInserts: run.edits?.nodeInserts },
    { nodeEdits: after, spanEdits: run.edits?.spanEdits, nodeInserts: run.edits?.nodeInserts },
  );
}
