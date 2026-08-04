// Hand editing of floor-derived wall stones — GitHub #19.
//
// The renderer composes a floor outline out of the same stones a drawn wall
// uses, but only the drawn wall had an object to hang edits on. These cover the
// operations against a ring: picking one, rotating and resizing a stone,
// inserting a neighbour, and undoing the lot.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { setNotify } from '@dnd/core/src/store/notify';
import { currentWallNodes } from '@/engine/wallNodeOverlay';
import {
  toggleNodeEditAt,
  exitNodeEdit,
  editWallNode,
  handleNodeKey,
  beginNodeDrag,
  nudgeWallNode,
  endNodeDrag,
  cancelNodeDrag,
  isDraggingNode,
} from './wallNodeEdit';
import type { DungeonLayer } from '@/store/types';
import type { Polygon } from '@/types/geometry';

/** Big enough that a run has plenty of stones to pick between. */
const RING: Polygon = [[0, 0], [12, 0], [12, 8], [0, 8]];

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function seed(): DungeonLayer {
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    mergedFloor: [RING],
    style: { ...l.style, wallTextureSetId: 'stone-slate' },
  } as Partial<DungeonLayer>);
  return layer();
}

function edits() {
  return layer().floorWallEdits?.['0'];
}

/**
 * A standalone wall in edit mode, with a stone away from the end caps picked.
 *
 * Stone drags on a floor RING are not stored as offsets at all — the stones
 * stand on the outline, so a drag there is an edit of the floor itself and goes
 * through the outline editor (see ringStoneDrag). A drawn wall has no floor
 * behind it, so its stones do float free, and that is what these cover.
 */
function seedWall(): { id: string; t: number } {
  const l = seed();
  useStore.getState().addWall(l.id, {
    id: 'w1',
    points: [[0, 12], [10, 12]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    width: 0.5,
    roughness: 0,
  });
  useStore.getState().setNodeEditWall('w1');
  const nodes = currentWallNodes();
  const t = nodes[Math.floor(nodes.length / 2)].t;
  useStore.getState().selectNode(t);
  return { id: 'w1', t };
}

function wallEdits() {
  return layer().standaloneWalls.find((w) => w.id === 'w1');
}

/** Enter edit mode on the ring and select a stone away from the corners. */
function selectMidStone(): number {
  useStore.getState().setNodeEditWall('floor:0');
  const nodes = currentWallNodes();
  const node = nodes[Math.floor(nodes.length / 2)];
  useStore.getState().selectNode(node.t);
  return node.t;
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('toggleNodeEditAt', () => {
  it('claims the nearest floor ring when there are no standalone walls', () => {
    seed();
    // On the south edge of the outline. Every wall on a finished map is like
    // this — floor-derived — and none of them used to be pickable.
    expect(toggleNodeEditAt({ x: 6, y: 0 })).toBe(true);
    expect(useStore.getState().tools.nodeEditWallId).toBe('floor:0');
  });

  it('toggles off when the same ring is picked again', () => {
    seed();
    toggleNodeEditAt({ x: 6, y: 0 });
    expect(toggleNodeEditAt({ x: 6, y: 0 })).toBe(false);
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
  });

  it('ignores a point well clear of the outline', () => {
    seed();
    expect(toggleNodeEditAt({ x: 6, y: 4 })).toBe(false);
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
  });

  it('prefers a standalone wall over the ring beneath it', () => {
    const l = seed();
    useStore.getState().addWall(l.id, {
      id: 'w1',
      points: [[4, 0], [8, 0]],
      wallType: 'normal',
      direction: 'both',
      color: '#000000',
      width: 0.5,
      roughness: 0,
    });
    toggleNodeEditAt({ x: 6, y: 0 });
    expect(useStore.getState().tools.nodeEditWallId).toBe('w1');
  });

  it('exitNodeEdit clears the mode', () => {
    seed();
    toggleNodeEditAt({ x: 6, y: 0 });
    exitNodeEdit();
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
  });
});

describe('editing a floor ring stone', () => {
  it('rotate writes to the layer, not to a wall segment', () => {
    const l = seed();
    const t = selectMidStone();
    editWallNode({ t, rotate: 0.25 });

    expect(edits()?.nodeEdits).toHaveLength(1);
    expect(edits()?.nodeEdits?.[0].rotate).toBeCloseTo(0.25, 10);
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(l.id).toBe(layer().id);
  });

  it('repeated presses accumulate into one edit and hold the selection', () => {
    seed();
    selectMidStone();
    // The bug this guards: editing relays the run and shifts every t, so
    // without re-anchoring each press landed on a different stone — and once
    // it drifted past the last one, handleNodeKey stopped claiming the key.
    for (let i = 0; i < 6; i++) {
      const sel = useStore.getState().tools.selectedNodeT;
      expect(sel).not.toBeNull();
      expect(handleNodeKey(']', sel!)).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      expect(handleNodeKey('=', useStore.getState().tools.selectedNodeT!)).toBe(true);
    }

    expect(edits()?.nodeEdits).toHaveLength(1);
    const edit = edits()!.nodeEdits![0];
    expect(edit.rotate).toBeCloseTo((30 * Math.PI) / 180, 10);
    expect(edit.scale).toBeCloseTo(1.1 ** 3, 10);
    expect(useStore.getState().tools.selectedNodeT).not.toBeNull();
  });

  it('the edited stone is the one that changes on screen', () => {
    seed();
    const t = selectMidStone();
    const before = currentWallNodes().find((n) => Math.abs(n.t - t) < 1e-9)!;
    editWallNode({ t, rotate: 0.3, scale: 1.5 });

    const sel = useStore.getState().tools.selectedNodeT!;
    const after = currentWallNodes().find((n) => Math.abs(n.t - sel) < 1e-9)!;
    expect(after.angle).toBeCloseTo(before.angle + 0.3, 6);
    expect(after.sizeScale).toBeCloseTo(1.5, 10);
  });

  it('span keys widen and tighten the seam', () => {
    seed();
    const t = selectMidStone();
    expect(handleNodeKey('.', t)).toBe(true);
    expect(edits()?.spanEdits?.[0].gap).toBeCloseTo(0.05, 10);
    // Back to zero drops the entry rather than leaving a no-op behind.
    expect(handleNodeKey(',', useStore.getState().tools.selectedNodeT!)).toBe(true);
    expect(edits()?.spanEdits).toEqual([]);
  });

  it('inserts a stone beside the selected one and selects it', () => {
    seed();
    const t = selectMidStone();
    const before = currentWallNodes();

    expect(handleNodeKey('}', t)).toBe(true);
    expect(edits()?.nodeInserts).toHaveLength(1);

    const inserted = edits()!.nodeInserts![0];
    expect(inserted.t).toBeGreaterThan(t);
    expect(inserted.t).toBeLessThanOrEqual(1);
    expect(currentWallNodes().length).toBe(before.length + 1);
    // Selected, so it can be rotated or sized straight away.
    expect(useStore.getState().tools.selectedNodeT).toBeCloseTo(inserted.t, 6);
  });

  it('inserts on the other side for the mirrored key', () => {
    seed();
    const t = selectMidStone();
    expect(handleNodeKey('{', t)).toBe(true);
    expect(edits()!.nodeInserts![0].t).toBeLessThan(t);
  });

  it('delete removes the stone and drops the selection', () => {
    seed();
    const t = selectMidStone();
    const before = currentWallNodes().length;

    expect(handleNodeKey('Delete', t)).toBe(true);
    expect(currentWallNodes()).toHaveLength(before - 1);
    // Otherwise the next keypress edits a stone that is no longer there.
    expect(useStore.getState().tools.selectedNodeT).toBeNull();
  });

  it('leaves unbound keys to the global shortcut table', () => {
    seed();
    const t = selectMidStone();
    expect(handleNodeKey('q', t)).toBe(false);
    expect(edits()).toBeUndefined();
  });

  it('does nothing when no run is in edit mode', () => {
    seed();
    editWallNode({ t: 0.5, rotate: 0.25 });
    expect(edits()).toBeUndefined();
  });
});

describe('undo', () => {
  it('one keypress is one undo step', () => {
    seed();
    const t = selectMidStone();
    handleNodeKey(']', t);
    expect(edits()?.nodeEdits).toHaveLength(1);

    undoManager.undo();
    expect(edits()?.nodeEdits ?? []).toHaveLength(0);
  });

  it('undo walks back to no edits at all, not an empty husk', () => {
    seed();
    const t = selectMidStone();
    handleNodeKey(']', t);
    handleNodeKey('}', useStore.getState().tools.selectedNodeT!);
    undoManager.undo();
    undoManager.undo();
    expect(edits()).toBeUndefined();
  });

  it('a whole drag is one undo step', () => {
    const { t } = seedWall();
    beginNodeDrag([t]);
    // A drag emits a move every few pixels; each one writes straight to the
    // store so undo does not have to walk the gesture back a fraction at a time.
    nudgeWallNode([t], 0.1, 0);
    nudgeWallNode([t], 0.1, 0);
    nudgeWallNode([t], 0.1, 0.2);
    endNodeDrag();

    const moved = wallEdits()!.nodeEdits!.find((e) => e.dx !== undefined)!;
    expect(moved.dx).toBeCloseTo(0.3, 10);
    expect(moved.dy).toBeCloseTo(0.2, 10);

    undoManager.undo();
    expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
    // The stones the drag derived go back with it, in the same step.
    expect(wallEdits()?.nodeInserts ?? []).toHaveLength(0);
  });

  it('a drag that moved nothing records no step', () => {
    const { t } = seedWall();
    beginNodeDrag([t]);
    endNodeDrag();
    expect(useStore.getState().ui.canUndo).toBe(false);
  });
});

describe('cancelNodeDrag', () => {
  it('puts the stone back and records nothing', () => {
    const { t } = seedWall();
    beginNodeDrag([t]);
    nudgeWallNode([t], 0.4, 0.3);
    expect(wallEdits()?.nodeEdits).toHaveLength(1);

    cancelNodeDrag();
    // The drag writes straight to the store, so abandoning it has to unwind
    // the mutation itself — there is no command on the stack to undo.
    expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(isDraggingNode()).toBe(false);
  });

  it('restores the edits the stone already had, rather than clearing them', () => {
    const { t } = seedWall();
    handleNodeKey(']', t);
    const settled = structuredClone(wallEdits()?.nodeEdits);

    beginNodeDrag([useStore.getState().tools.selectedNodeT!]);
    nudgeWallNode([useStore.getState().tools.selectedNodeT!], 0.4, 0.3);
    cancelNodeDrag();

    expect(wallEdits()?.nodeEdits).toEqual(settled);
  });

  it('does nothing when no drag is in flight', () => {
    seed();
    selectMidStone();
    expect(() => cancelNodeDrag()).not.toThrow();
    expect(edits()).toBeUndefined();
  });
});

describe('a stone on a floor ring', () => {
  it('is never given an offset of its own — the outline moves instead', () => {
    seed();
    useStore.getState().setNodeEditWall('floor:0');
    const nodes = currentWallNodes();
    const ts = nodes.slice(3, 7).map((n) => n.t);
    for (const t of ts) useStore.getState().toggleNodeSelection(t);

    beginNodeDrag(useStore.getState().tools.selectedNodeTs);
    nudgeWallNode(useStore.getState().tools.selectedNodeTs, 0.4, -0.2);
    endNodeDrag();

    // A ring's stones stand ON the floor boundary. Sliding one off it with a
    // dx/dy was what left the fill behind the band and, on a curve, tore the
    // deformed contour into self-intersecting wedges.
    expect((edits()?.nodeEdits ?? []).some((e) => e.dx || e.dy)).toBe(false);
  });

  it('ignores an offset a previous version of the editor left behind', () => {
    const l = seed();
    useStore.getState().setNodeEditWall('floor:0');
    const before = currentWallNodes();
    const target = before[4];
    useStore
      .getState()
      .setFloorWallEdits(l.id, '0', { nodeEdits: [{ t: target.t, dx: 3, dy: 3, rotate: 0.2 }] });

    const after = currentWallNodes().find((n) => Math.abs(n.t - target.t) < 1e-9)!;
    expect(after.x).toBeCloseTo(target.x, 10);
    expect(after.y).toBeCloseTo(target.y, 10);
    // The cosmetic half of the same edit still lands.
    expect(after.angle).toBeCloseTo(target.angle + 0.2, 10);
  });
});

describe('group drag', () => {
  it('moves every picked stone by the same delta, as one undo step', () => {
    seedWall();
    const nodes = currentWallNodes();
    // Four neighbouring stones away from the wall's end caps.
    const picked = nodes.slice(1, 5);
    useStore.getState().selectNode(null);
    for (const n of picked) useStore.getState().toggleNodeSelection(n.t);
    const ts = useStore.getState().tools.selectedNodeTs;
    expect(ts).toHaveLength(4);

    beginNodeDrag(ts);
    nudgeWallNode(ts, 0.2, -0.1);
    nudgeWallNode(ts, 0.2, -0.1);
    endNodeDrag();

    const moved = wallEdits()!.nodeEdits!.filter((e) => e.dx !== undefined);
    expect(moved).toHaveLength(4);
    for (const e of moved) {
      expect(e.dx).toBeCloseTo(0.4, 10);
      expect(e.dy).toBeCloseTo(-0.2, 10);
    }

    undoManager.undo();
    expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
  });

  it('shift-click drops a stone back out of the selection', () => {
    seed();
    useStore.getState().setNodeEditWall('floor:0');
    const nodes = currentWallNodes();
    const [a, b] = [nodes[3], nodes[4]];
    useStore.getState().toggleNodeSelection(a.t);
    useStore.getState().toggleNodeSelection(b.t);
    expect(useStore.getState().tools.selectedNodeT).toBe(b.t);

    useStore.getState().toggleNodeSelection(b.t);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([a.t]);
    // The primary never points at a stone that is no longer picked.
    expect(useStore.getState().tools.selectedNodeT).toBe(a.t);
  });

  it('a plain click replaces the selection, leaving single-stone editing as it was', () => {
    seed();
    useStore.getState().setNodeEditWall('floor:0');
    const nodes = currentWallNodes();
    useStore.getState().toggleNodeSelection(nodes[3].t);
    useStore.getState().toggleNodeSelection(nodes[4].t);
    useStore.getState().selectNode(nodes[7].t);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([nodes[7].t]);
    useStore.getState().selectNode(null);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([]);
  });
});

// A drag tears the run open and the layout bridges the seam by cloning the
// leading stone. Those clones used to be recomputed every frame with nothing
// behind them, so every edit aimed at one fell through to the stone it was
// cloned from — Tab on any of them swapped all of them at once.
describe('bridge stones a drag creates', () => {
  /** Drag one stone far enough sideways that the seam has to be bridged. */
  function dragOpenASeam(t: number): number {
    beginNodeDrag([t]);
    nudgeWallNode([t], 0, -1.2);
    endNodeDrag();
    return t;
  }

  it('each become a node of their own, in the same undo step as the drag', () => {
    dragOpenASeam(seedWall().t);
    const inserts = wallEdits()!.nodeInserts!;
    expect(inserts.length).toBeGreaterThan(1);
    // Distinct anchors, or two of them would answer to one edit.
    expect(new Set(inserts.map((i) => i.t)).size).toBe(inserts.length);
    expect(useStore.getState().ui.canUndo).toBe(true);

    undoManager.undo();
    expect(wallEdits()?.nodeInserts ?? []).toHaveLength(0);
    expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('are laid exactly where the derived stones were', () => {
    const { id, t } = seedWall();
    // The same seam, bridged the old way: written straight to the store so the
    // layout derives the bridges and nothing persists them.
    useStore.getState().updateWall(layer().id, id, { nodeEdits: [{ t, dx: 0, dy: -1.2 }] });
    const derived = currentWallNodes().filter((n) => n.kind === 'inserted');
    expect(derived.length).toBeGreaterThan(1);
    useStore.getState().updateWall(layer().id, id, { nodeEdits: undefined });

    dragOpenASeam(t);
    const real = currentWallNodes().filter((n) => n.kind === 'inserted');
    expect(real).toHaveLength(derived.length);
    for (let i = 0; i < real.length; i++) {
      expect(real[i].pieceId).toBe(derived[i].pieceId);
      expect(real[i].x).toBeCloseTo(derived[i].x, 6);
      expect(real[i].y).toBeCloseTo(derived[i].y, 6);
      // The angle is the one that needs correcting: an insert's comes from its
      // neighbours, a bridge's from the seam it spans.
      expect(real[i].angle).toBeCloseTo(derived[i].angle, 6);
      expect(real[i].sizeScale).toBeCloseTo(derived[i].sizeScale, 6);
    }
  });

  it('take a piece swap one at a time', () => {
    dragOpenASeam(seedWall().t);
    const bridges = currentWallNodes().filter((n) => n.kind === 'inserted');
    const target = bridges[0];
    const others = bridges.slice(1).map((n) => n.pieceId);

    handleNodeKey('Tab', target.t);

    const after = currentWallNodes().filter((n) => n.kind === 'inserted');
    expect(after.find((n) => Math.abs(n.t - target.t) < 1e-9)!.pieceId).not.toBe(target.pieceId);
    expect(after.slice(1).map((n) => n.pieceId)).toEqual(others);
  });

  it('take a delete one at a time, and are not bridged straight back', () => {
    dragOpenASeam(seedWall().t);
    const before = currentWallNodes().filter((n) => n.kind === 'inserted');
    handleNodeKey('Delete', before[0].t);
    const after = currentWallNodes().filter((n) => n.kind === 'inserted');
    expect(after).toHaveLength(before.length - 1);
  });

  it('are written out once, not again on every later edit', () => {
    const t = dragOpenASeam(seedWall().t);
    const first = wallEdits()!.nodeInserts!.length;
    editWallNode({ t, rotate: 0.05 });
    editWallNode({ t: useStore.getState().tools.selectedNodeT!, scale: 1.1 });
    expect(wallEdits()!.nodeInserts).toHaveLength(first);
  });

  it('leaves a wall whose stones still touch without any', () => {
    const { t } = seedWall();
    beginNodeDrag([t]);
    nudgeWallNode([t], 0.01, 0);
    endNodeDrag();
    expect(wallEdits()?.nodeInserts ?? []).toHaveLength(0);
  });
});

// A layer resolution that only checked type + active-layer id let node editing
// reach into a locked or hidden layer — matching shapeNodeEdit.ts's own
// exists/visible/!locked check closes the same hole here.
describe('locked/hidden layer blocks node edits (F6)', () => {
  it('toggleNodeEditAt refuses to enter edit mode on a locked layer', () => {
    const l = seed();
    useStore.getState().updateLayer(l.id, { locked: true });
    expect(toggleNodeEditAt({ x: 6, y: 0 })).toBe(false);
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
  });

  it('toggleNodeEditAt refuses to enter edit mode on a hidden layer', () => {
    const l = seed();
    useStore.getState().updateLayer(l.id, { visible: false });
    expect(toggleNodeEditAt({ x: 6, y: 0 })).toBe(false);
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
  });

  it('Tab (cyclePiece) does nothing once the layer is locked mid-edit', () => {
    const { t } = seedWall();
    const before = currentWallNodes().find((n) => Math.abs(n.t - t) < 1e-9)?.pieceId;
    useStore.getState().updateLayer(layer().id, { locked: true });

    expect(handleNodeKey('Tab', t)).toBe(true); // still claims the key
    const after = currentWallNodes().find((n) => Math.abs(n.t - t) < 1e-9)?.pieceId;
    expect(after).toBe(before);
  });

  // activeWall() only ever checked type + active-layer id, with no lock or
  // visibility check at all — so a layer locked AFTER node-edit mode was
  // entered could still have its stones dragged, nudged and committed.
  // activeEditableRun() is the one function every write path routes through,
  // so guarding it there closes drag begin/nudge/commit in one place.
  describe('locked mid-edit blocks the drag itself, not just cancel', () => {
    let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

    beforeEach(() => {
      warning = vi.fn();
      setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    });

    it('beginNodeDrag refuses and warns once the layer is locked before the press', () => {
      const { t } = seedWall();
      useStore.getState().updateLayer(layer().id, { locked: true });

      beginNodeDrag([t]);
      expect(isDraggingNode()).toBe(false);
      expect(warning).toHaveBeenCalledWith('Layer is locked');

      nudgeWallNode([t], 0.4, 0.3);
      expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
    });

    it('nudgeWallNode stops writing once the layer locks mid-drag', () => {
      const { t } = seedWall();
      beginNodeDrag([t]);
      nudgeWallNode([t], 0.1, 0);
      expect(wallEdits()?.nodeEdits).toHaveLength(1);
      const midDrag = structuredClone(wallEdits()!.nodeEdits);

      useStore.getState().updateLayer(layer().id, { locked: true });
      warning.mockClear();
      nudgeWallNode([t], 0.4, 0.3);

      // No further write past the lock, and the caller was told why.
      expect(wallEdits()!.nodeEdits).toEqual(midDrag);
      expect(warning).toHaveBeenCalledWith('Layer is locked');

      // Rewind is always allowed, lock or not — leaves the module's drag
      // state clean instead of leaking a stale gesture into later tests.
      cancelNodeDrag();
      expect(isDraggingNode()).toBe(false);
    });

    it('endNodeDrag refuses to commit once the layer locks mid-drag, and reverts the nudge', () => {
      const { t } = seedWall();
      beginNodeDrag([t]);
      nudgeWallNode([t], 0.4, 0.3);
      expect(wallEdits()?.nodeEdits).toHaveLength(1);

      useStore.getState().updateLayer(layer().id, { locked: true });
      warning.mockClear();
      endNodeDrag();

      // Nothing landed on the undo stack — the commit never happened.
      expect(useStore.getState().ui.canUndo).toBe(false);
      expect(warning).toHaveBeenCalledWith('Layer is locked');
      // And the live-written nudge — which had no undo entry behind it — is
      // put back rather than left stuck in the store.
      expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
    });

    it('beginNodeDrag refuses and warns on a hidden layer', () => {
      const { t } = seedWall();
      useStore.getState().updateLayer(layer().id, { visible: false });

      beginNodeDrag([t]);
      expect(isDraggingNode()).toBe(false);
      expect(warning).toHaveBeenCalledWith('Layer is hidden');
    });
  });

  it('cancelNodeDrag still restores the rewind once the layer is locked mid-drag', () => {
    const { t } = seedWall();
    beginNodeDrag([t]);
    nudgeWallNode([t], 0.4, 0.3);
    expect(wallEdits()?.nodeEdits).toHaveLength(1);

    // Locked between the nudge and the cancel: a rewind is not an edit, so it
    // has to go through regardless — otherwise a drag caught by a lock that
    // lands mid-gesture becomes un-cancellable.
    useStore.getState().updateLayer(layer().id, { locked: true });
    cancelNodeDrag();
    expect(wallEdits()?.nodeEdits ?? []).toHaveLength(0);
  });

  // beginNodeDrag gates entry to a ring drag through activeEditableRun(), but
  // the ring branch of endNodeDrag called endRingStoneDrag() with no re-check
  // — so a ring drag released after a mid-drag lock still committed the
  // relaid outline (X4). Same shape as the standalone-wall case above: blocked
  // at release must cancel the outline-editor session, not land it.
  it('endNodeDrag reverts a ring stone drag instead of committing once the layer locks mid-drag', () => {
    const l = seed();
    const t = selectMidStone();
    const before = structuredClone(layer().children);

    beginNodeDrag([t]);
    nudgeWallNode([t], 0.4, -0.2);

    useStore.getState().updateLayer(l.id, { locked: true });
    endNodeDrag();

    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(layer().children).toEqual(before);
  });
});

describe('selection plumbing', () => {
  it('a plain click replaces the selection, leaving single-stone editing as it was', () => {
    seed();
    useStore.getState().setNodeEditWall('floor:0');
    const nodes = currentWallNodes();
    useStore.getState().toggleNodeSelection(nodes[3].t);
    useStore.getState().toggleNodeSelection(nodes[4].t);
    useStore.getState().selectNode(nodes[7].t);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([nodes[7].t]);
    useStore.getState().selectNode(null);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([]);
  });
});
