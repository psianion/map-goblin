// Floor-derived walls are editable too — GitHub #19.
//
// Almost every wall on a finished map comes from the floor outline rather than
// a hand-drawn WallSegment, and node editing was originally wired only to the
// segments. These cover the ring path end to end: resolve, edit, persist, undo.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/store';
import { UpdateFloorWallEditsCommand } from '../store/commands';
import { undoManager } from '../store/undoManager';
import {
  FLOOR_WALL_PREFIX,
  floorRingIndex,
  activeEditableRun,
  currentWallNodes,
} from './wallNodeOverlay';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';
import type { WallSegment } from '../shared/types';

const RING: Polygon = [[0, 0], [8, 0], [8, 6], [0, 6]];
const HOLE: Polygon = [[2, 2], [4, 2], [4, 4], [2, 4]];

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

/** A layer with a floor outline and a wall set, ready to be node-edited. */
function seedFloor(rings: Polygon[] = [RING]): DungeonLayer {
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    mergedFloor: rings,
    style: { ...l.style, wallTextureSetId: 'stone-slate' },
  } as Partial<DungeonLayer>);
  return layer();
}

function wall(id: string): WallSegment {
  return {
    id,
    points: [[0, 0], [5, 0]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    width: 0.5,
    roughness: 0,
  };
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('floorRingIndex', () => {
  it('parses a floor ring id', () => {
    expect(floorRingIndex(`${FLOOR_WALL_PREFIX}0`)).toBe(0);
    expect(floorRingIndex(`${FLOOR_WALL_PREFIX}12`)).toBe(12);
  });

  it('returns null for a standalone wall id', () => {
    expect(floorRingIndex('wall-abc')).toBeNull();
    // A uuid can contain the word but never the prefix at position 0.
    expect(floorRingIndex('x-floor:0')).toBeNull();
  });

  it('rejects malformed indices rather than coercing them', () => {
    // Number('') is 0 and Number(' 1 ') is 1 — both would silently address a
    // real ring if the guard were a bare Number() call.
    expect(floorRingIndex(FLOOR_WALL_PREFIX)).toBeNull();
    expect(floorRingIndex(`${FLOOR_WALL_PREFIX}-1`)).toBeNull();
    expect(floorRingIndex(`${FLOOR_WALL_PREFIX}1.5`)).toBeNull();
    expect(floorRingIndex(`${FLOOR_WALL_PREFIX}x`)).toBeNull();
  });
});

describe('activeEditableRun', () => {
  it('is null when nothing is in edit mode', () => {
    seedFloor();
    expect(activeEditableRun()).toBeNull();
  });

  it('resolves a floor ring to a closed run at the layer wall width', () => {
    const l = seedFloor();
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);

    const run = activeEditableRun();
    expect(run).not.toBeNull();
    expect(run?.closed).toBe(true);
    expect(run?.points).toEqual(RING);
    expect(run?.width).toBe(l.style.wallWidth);
    expect(run?.edits).toBeUndefined();
  });

  it('resolves the addressed ring, not just the first', () => {
    seedFloor([RING, HOLE]);
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}1`);
    expect(activeEditableRun()?.points).toEqual(HOLE);
  });

  it('resolves a standalone wall to an open run carrying its own edits', () => {
    const l = seedFloor();
    useStore.getState().addWall(l.id, wall('w1'));
    useStore.getState().updateWall(l.id, 'w1', { nodeEdits: [{ t: 0.5, rotate: 0.2 }] });
    useStore.getState().setNodeEditWall('w1');

    const run = activeEditableRun();
    expect(run?.closed).toBe(false);
    expect(run?.edits?.nodeEdits).toEqual([{ t: 0.5, rotate: 0.2 }]);
  });

  it('is null for a ring index that no longer exists', () => {
    // The failure mode behind the ring-index caveat: delete a floor island and
    // the ids renumber. Better to resolve nothing than the wrong ring.
    seedFloor();
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}3`);
    expect(activeEditableRun()).toBeNull();
  });

  it('is null for a degenerate ring', () => {
    seedFloor([[[0, 0], [1, 1]]]);
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    expect(activeEditableRun()).toBeNull();
  });
});

describe('currentWallNodes on a floor ring', () => {
  it('lays out stones around the whole outline', () => {
    seedFloor();
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    const nodes = currentWallNodes();
    expect(nodes.length).toBeGreaterThan(4);
    // Closed ring: every node sits within the outline's bounds.
    for (const n of nodes) {
      expect(n.t).toBeGreaterThanOrEqual(0);
      expect(n.t).toBeLessThanOrEqual(1);
    }
  });

  it('returns nothing without a wall set, matching the renderer', () => {
    const l = seedFloor();
    useStore.getState().updateLayer(l.id, {
      style: { ...l.style, wallTextureSetId: undefined },
    } as Partial<DungeonLayer>);
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    expect(currentWallNodes()).toEqual([]);
  });

  it('applies the layer-held edits — the bug: rings had no edit pass', () => {
    const l = seedFloor();
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    const before = currentWallNodes();
    const t = before[1].t;

    useStore.getState().setFloorWallEdits(l.id, '0', {
      nodeEdits: [{ t, rotate: 0.5, scale: 1.4 }],
    });

    const after = currentWallNodes();
    const edited = after.find((n) => Math.abs(n.t - t) < 1e-9);
    expect(edited).toBeDefined();
    expect(edited!.angle).toBeCloseTo(before[1].angle + 0.5, 10);
    expect(edited!.sizeScale).toBeCloseTo(1.4, 10);
  });

  it('drops a removed stone', () => {
    const l = seedFloor();
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    const before = currentWallNodes();
    useStore.getState().setFloorWallEdits(l.id, '0', {
      nodeEdits: [{ t: before[2].t, removed: true }],
    });
    expect(currentWallNodes()).toHaveLength(before.length - 1);
  });

  it('keeps each ring on its own edits', () => {
    const l = seedFloor([RING, HOLE]);
    useStore.getState().setFloorWallEdits(l.id, '0', {
      nodeEdits: [{ t: 0, removed: true }],
    });

    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}1`);
    expect(activeEditableRun()?.edits).toBeUndefined();
  });
});

describe('setFloorWallEdits', () => {
  it('creates the map lazily and stores under the ring key', () => {
    const l = seedFloor();
    expect(layer().floorWallEdits).toBeUndefined();

    useStore.getState().setFloorWallEdits(l.id, '0', { nodeEdits: [{ t: 0.25, rotate: 0.1 }] });
    expect(layer().floorWallEdits).toEqual({ '0': { nodeEdits: [{ t: 0.25, rotate: 0.1 }] } });
  });

  it('replaces rather than merges', () => {
    const l = seedFloor();
    useStore.getState().setFloorWallEdits(l.id, '0', { nodeEdits: [{ t: 0.25 }] });
    useStore.getState().setFloorWallEdits(l.id, '0', { spanEdits: [{ t: 0.5, gap: 0.1 }] });
    expect(layer().floorWallEdits?.['0'].nodeEdits).toBeUndefined();
  });

  it('undefined clears one ring and leaves the others', () => {
    const l = seedFloor([RING, HOLE]);
    useStore.getState().setFloorWallEdits(l.id, '0', { nodeEdits: [{ t: 0.25 }] });
    useStore.getState().setFloorWallEdits(l.id, '1', { nodeEdits: [{ t: 0.75 }] });
    useStore.getState().setFloorWallEdits(l.id, '0', undefined);

    expect(layer().floorWallEdits).toEqual({ '1': { nodeEdits: [{ t: 0.75 }] } });
  });

  it('ignores unknown layers', () => {
    seedFloor();
    expect(() => useStore.getState().setFloorWallEdits('nope', '0', {})).not.toThrow();
    expect(layer().floorWallEdits).toBeUndefined();
  });
});

describe('UpdateFloorWallEditsCommand', () => {
  it('execute writes and undo restores the prior edits', () => {
    const l = seedFloor();
    const before = { nodeEdits: [{ t: 0.25, rotate: 0.1 }] };
    const after = { nodeEdits: [{ t: 0.25, rotate: 0.6 }] };
    useStore.getState().setFloorWallEdits(l.id, '0', before);

    const cmd = new UpdateFloorWallEditsCommand(l.id, '0', before, after);
    cmd.execute();
    expect(layer().floorWallEdits?.['0']).toEqual(after);

    cmd.undo();
    expect(layer().floorWallEdits?.['0']).toEqual(before);
  });

  it('undo to undefined removes the key, not an empty object', () => {
    const l = seedFloor();
    const cmd = new UpdateFloorWallEditsCommand(l.id, '0', undefined, { nodeEdits: [{ t: 0 }] });
    cmd.execute();
    cmd.undo();
    expect(layer().floorWallEdits?.['0']).toBeUndefined();
  });

  it('snapshots its arguments, so a later mutation cannot rewrite history', () => {
    const l = seedFloor();
    const before = { nodeEdits: [{ t: 0.25, rotate: 0.1 }] };
    const cmd = new UpdateFloorWallEditsCommand(l.id, '0', before, { nodeEdits: [] });
    before.nodeEdits[0].rotate = 99;

    cmd.execute();
    cmd.undo();
    expect(layer().floorWallEdits?.['0'].nodeEdits?.[0].rotate).toBe(0.1);
  });
});

describe('persistence', () => {
  it('survives a save/load round trip', () => {
    const l = seedFloor();
    const edits = { nodeEdits: [{ t: 0.25, rotate: 0.4, scale: 1.2 }] };
    useStore.getState().setFloorWallEdits(l.id, '0', edits);

    const saved = structuredClone(useStore.getState().getSerializableState());
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(saved);

    expect(layer().floorWallEdits).toEqual({ '0': edits });
  });

  it('loading a map drops the node-edit target', () => {
    const l = seedFloor();
    const saved = structuredClone(useStore.getState().getSerializableState());
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    useStore.getState().selectNode(0.25);
    useStore.getState().setShapeNodeEdit(l.id);

    useStore.getState().loadFromFile(saved);

    // `floor:0` names a ring index, not a map. Left set, edit mode reattaches
    // to whatever ring 0 happens to be in the map just opened.
    const tools = useStore.getState().tools;
    expect(tools.nodeEditWallId).toBeNull();
    expect(tools.selectedNodeT).toBeNull();
    expect(tools.shapeNodeEditId).toBeNull();
    expect(tools.selectedVertex).toBeNull();
  });
});
