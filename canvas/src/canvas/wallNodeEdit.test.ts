// Hand editing of floor-derived wall stones — GitHub #19.
//
// The renderer composes a floor outline out of the same stones a drawn wall
// uses, but only the drawn wall had an object to hang edits on. These cover the
// operations against a ring: picking one, rotating and resizing a stone,
// inserting a neighbour, and undoing the lot.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
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
    seed();
    const t = selectMidStone();
    beginNodeDrag();
    // A drag emits a move every few pixels; each one writes straight to the
    // store so undo does not have to walk the gesture back a fraction at a time.
    nudgeWallNode(t, 0.1, 0);
    nudgeWallNode(t, 0.1, 0);
    nudgeWallNode(t, 0.1, 0.2);
    endNodeDrag();

    const moved = edits()!.nodeEdits![0];
    expect(moved.dx).toBeCloseTo(0.3, 10);
    expect(moved.dy).toBeCloseTo(0.2, 10);

    undoManager.undo();
    expect(edits()?.nodeEdits ?? []).toHaveLength(0);
  });

  it('a drag that moved nothing records no step', () => {
    seed();
    selectMidStone();
    beginNodeDrag();
    endNodeDrag();
    expect(useStore.getState().ui.canUndo).toBe(false);
  });
});

describe('cancelNodeDrag', () => {
  it('puts the stone back and records nothing', () => {
    seed();
    const t = selectMidStone();
    beginNodeDrag();
    nudgeWallNode(t, 0.4, 0.3);
    expect(edits()?.nodeEdits).toHaveLength(1);

    cancelNodeDrag();
    // The drag writes straight to the store, so abandoning it has to unwind
    // the mutation itself — there is no command on the stack to undo.
    expect(edits()).toBeUndefined();
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(isDraggingNode()).toBe(false);
  });

  it('restores the edits the stone already had, rather than clearing them', () => {
    seed();
    const t = selectMidStone();
    handleNodeKey(']', t);
    const settled = structuredClone(edits());

    beginNodeDrag();
    nudgeWallNode(useStore.getState().tools.selectedNodeT!, 0.4, 0.3);
    cancelNodeDrag();

    expect(edits()).toEqual(settled);
  });

  it('leaves a wall segment alone the same way', () => {
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
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);

    beginNodeDrag();
    nudgeWallNode(t, 0.4, 0.3);
    cancelNodeDrag();

    const wall = layer().standaloneWalls.find((w) => w.id === 'w1');
    expect(wall?.nodeEdits ?? []).toHaveLength(0);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('does nothing when no drag is in flight', () => {
    seed();
    selectMidStone();
    expect(() => cancelNodeDrag()).not.toThrow();
    expect(edits()).toBeUndefined();
  });
});
