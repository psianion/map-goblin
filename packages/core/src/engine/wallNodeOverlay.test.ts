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
  seedTestWallSets,
  resetAssetPackManager,
  seedCaveBandPack,
  caveBandChildren,
} from '../testing/seedCatalog';
import {
  FLOOR_WALL_PREFIX,
  BAND_WALL_PREFIX,
  floorRingIndex,
  bandRunIndex,
  bandRunAt,
  bandJointT,
  bandJointIndex,
  setBandTransientT,
  activeEditableRun,
  currentWallNodes,
  noWallStonesReason,
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
    style: { ...l.style, wallTextureSetId: 'GG_Test' },
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
  resetAssetPackManager();
  seedTestWallSets(['GG_Test']);
  // The insert handle is module state with a gesture's lifetime, so no case
  // inherits one from the last.
  setBandTransientT(null);
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

/**
 * A WallSegment carries no closed flag, so a drawn loop was laid out as a
 * chain: two `ending` caps dropped at the seam, no junction there, and the
 * edit dim painted over the ring's own interior. The cave map's `wall-001` is
 * exactly this — a couple of hundred points whose last repeats its first.
 */
describe('a drawn wall that loops back onto itself', () => {
  const LOOP: [number, number][] = [[0, 10], [12, 10], [12, 20], [0, 20], [0, 10]];

  function seedLoop(points: [number, number][]): void {
    const l = seedFloor();
    useStore.getState().addWall(l.id, { ...wall('loop'), points });
    useStore.getState().setNodeEditWall('loop');
  }

  it('resolves as a closed run', () => {
    seedLoop(LOOP);
    expect(activeEditableRun()?.closed).toBe(true);
  });

  it('lays out with no end caps at the seam', () => {
    seedLoop(LOOP);
    expect(currentWallNodes().some((n) => n.kind === 'ending')).toBe(false);
  });

  it('leaves the same run open when the closing point is missing', () => {
    seedLoop(LOOP.slice(0, -1));
    expect(activeEditableRun()?.closed).toBe(false);
    expect(currentWallNodes().some((n) => n.kind === 'ending')).toBe(true);
  });
});

describe('noWallStonesReason', () => {
  it('is null while the layer has a wall set with pieces', () => {
    expect(noWallStonesReason(seedFloor())).toBeNull();
  });

  // The cave case: walls are invisible sight geometry under painted scatter,
  // so the layer ships no wall set and there is no stone to hand a handle to.
  it('names the missing wall set, and matches what currentWallNodes finds', () => {
    const l = seedFloor();
    useStore.getState().updateLayer(l.id, {
      style: { ...l.style, wallTextureSetId: undefined },
    } as Partial<DungeonLayer>);

    expect(noWallStonesReason(layer())).toBe(
      'Layer has no wall texture set — pick one to edit its stones',
    );
    useStore.getState().setNodeEditWall(`${FLOOR_WALL_PREFIX}0`);
    expect(currentWallNodes()).toEqual([]);
  });

  it('names a set whose pack has not landed yet', () => {
    const l = seedFloor();
    useStore.getState().updateLayer(l.id, {
      style: { ...l.style, wallTextureSetId: 'GG_NotInstalled' },
    } as Partial<DungeonLayer>);
    expect(noWallStonesReason(layer())).toMatch(/still loading/);
  });
});

/**
 * Node mode's second source — the cave band (see caveBand.ts).
 *
 * A cave wall is a run of placed rock children, not stones a texture set
 * composed, so the handles ride the JOINTS between pieces. Everything the stone
 * path already has — multi-select, group drag, the status bar — is keyed by a
 * `t` along a spine, and a joint has an index instead; the synthetic `t` is what
 * lets all of it work unchanged.
 */
describe('a cave band', () => {
  /** Three kit straights laid nose to tail along y = 20, clear of RING. */
  function seedBand(): { span: number; keys: string[] } {
    const { children, keys, span } = caveBandChildren();
    const l = layer();
    useStore.getState().updateLayer(l.id, {
      children,
      // The cave case: no wall texture set at all, which is what used to make
      // node mode a dead end here.
      style: { ...l.style, wallTextureSetId: undefined },
    } as Partial<DungeonLayer>);
    return { span, keys };
  }

  beforeEach(() => {
    seedCaveBandPack();
  });

  it('resolves a band id to an open run standing on its joints', () => {
    const { span } = seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);

    const run = activeEditableRun();
    expect(run?.kind).toBe('band');
    expect(run?.closed).toBe(false);
    // Three pieces nose to tail, so four joints: both free ends count.
    expect(run?.points).toHaveLength(4);
    expect(run?.points[0][0]).toBeCloseTo(0, 9);
    expect(run?.points[3][0]).toBeCloseTo(span, 9);
    // Nothing to patch — a band's pieces are real children.
    expect(run?.edits).toBeUndefined();
  });

  it('is null for a band index that no longer exists', () => {
    seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}3`);
    expect(activeEditableRun()).toBeNull();
  });

  it('puts one handle on every joint, in walk order', () => {
    seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);
    const band = activeEditableRun()!;

    const nodes = currentWallNodes();
    expect(nodes).toHaveLength(band.points.length);
    for (const [i, node] of nodes.entries()) {
      expect(node.x).toBeCloseTo(band.points[i][0], 9);
      expect(node.y).toBeCloseTo(band.points[i][1], 9);
    }
    // Handles at joints, never at piece centres: the first sits on the free end
    // of the run, not half a piece along it.
    expect(nodes[0].x).toBeCloseTo(0, 9);
  });

  it('names the piece that starts at each joint', () => {
    const { keys } = seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);
    // The trailing free end has no piece after it, so it names the one ending
    // there rather than an empty string.
    expect(currentWallNodes().map((n) => n.pieceId)).toEqual([...keys, keys[2]]);
  });

  it('keys a joint into the selection plumbing with a round-trippable t', () => {
    // Node identity is a float compare at 1e-9, so index → t → index has to be
    // exact well past any band a map can hold. The Warren's is 127.
    for (const count of [1, 3, 127, 1000]) {
      for (let i = 0; i < count; i++) {
        expect(bandJointIndex(bandJointT(i, count), count)).toBe(i);
      }
    }
    expect(bandJointT(0, 0)).toBe(0);
    // And the insert gesture's handle keeps its fraction: rounding it to the
    // nearest joint would hand the solver the wrong span.
    for (const count of [3, 127]) {
      const t = bandJointT(1.5, count);
      setBandTransientT(t);
      expect(bandJointIndex(t, count)).toBe(1.5);
      // The same fraction with no gesture behind it is a `t` keyed to a joint
      // count that has since moved, and names the joint it lands nearest.
      setBandTransientT(null);
      expect(bandJointIndex(t, count)).toBe(2);
    }
  });

  it('reads a `t` keyed to a joint count that has moved as its nearest joint', () => {
    // The live case: a drag landed 126 joints and the selection was re-keyed to
    // 121 of them; the undo put the 127-joint band back, and 121/126 × 127 is
    // 121.96. Inferring "transient" from that fraction is what made Delete
    // right after an undo silently deselect instead of straighten.
    const stale = bandJointT(121, 126);
    expect(stale * 127).not.toBe(Math.round(stale * 127));
    expect(bandJointIndex(stale, 127)).toBe(122);
    // A count that shrank far enough to put the nearest joint past the end of
    // the band still names one the band has.
    expect(bandJointIndex(bandJointT(9, 10), 4)).toBe(3);
    expect(bandJointIndex(bandJointT(0, 4), 0)).toBe(0);
  });

  it('draws a transient handle for a fractional t, and forgets it on deselect', () => {
    seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);
    const joints = currentWallNodes();
    expect(joints).toHaveLength(4);

    // The insert gesture's whole state: a `t` between two joints, and the mark
    // saying the gesture is what put it there. Nothing is written anywhere, so
    // there is nothing to clean up either.
    const t = bandJointT(1.5, 4);
    setBandTransientT(t);
    useStore.getState().selectNode(t);
    const nodes = currentWallNodes();
    expect(nodes).toHaveLength(5);
    const [added] = nodes.slice(-1);
    expect(added.t).toBe(t);
    expect(added.x).toBeCloseTo((joints[1].x + joints[2].x) / 2, 9);
    expect(added.y).toBeCloseTo((joints[1].y + joints[2].y) / 2, 9);
    // It is the primary, so it draws with the double ring the keys act on.
    expect(useStore.getState().tools.selectedNodeT).toBe(added.t);
    // And the real joints are untouched — the handle is an extra, not a swap.
    expect(nodes.slice(0, 4)).toEqual(joints);

    useStore.getState().selectNode(null);
    expect(currentWallNodes()).toEqual(joints);
  });

  it('keeps a transient handle off the free ends of an open run', () => {
    seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);
    // There is no span past a free end to sit in, so a `t` out there draws
    // nothing rather than wrapping round to the other end of the wall.
    for (const at of [-0.5, 3.5]) {
      const t = bandJointT(at, 4);
      setBandTransientT(t);
      useStore.getState().selectNode(t);
      expect(currentWallNodes(), `${at}`).toHaveLength(4);
    }
  });

  it('shift-click builds a group out of two joints', () => {
    seedBand();
    useStore.getState().setNodeEditWall(`${BAND_WALL_PREFIX}0`);
    const [a, b] = currentWallNodes().slice(1, 3);

    useStore.getState().toggleNodeSelection(a.t);
    useStore.getState().toggleNodeSelection(b.t);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([a.t, b.t]);
    expect(useStore.getState().tools.selectedNodeT).toBe(b.t);

    // And back out again, with the primary never left pointing at a joint that
    // is no longer picked.
    useStore.getState().toggleNodeSelection(b.t);
    expect(useStore.getState().tools.selectedNodeTs).toEqual([a.t]);
    expect(useStore.getState().tools.selectedNodeT).toBe(a.t);
  });

  describe('bandRunAt', () => {
    it('claims the band from a point along the rock, not just at a joint', () => {
      const { span } = seedBand();
      // Mid-piece: on a long straight the nearest joint is cells away, which is
      // why the pick tests the whole spine.
      expect(bandRunAt(layer(), { x: span / 2, y: 20.2 }, 0.6)).toBe(`${BAND_WALL_PREFIX}0`);
    });

    it('finds nothing well clear of the band', () => {
      seedBand();
      expect(bandRunAt(layer(), { x: 3, y: 0 }, 0.6)).toBeNull();
    });

    it('finds nothing on a layer that has no band at all', () => {
      seedFloor();
      expect(bandRunAt(layer(), { x: 4, y: 0 }, 0.6)).toBeNull();
    });
  });

  it('parses and rejects band ids the way floor ring ids are', () => {
    expect(bandRunIndex(`${BAND_WALL_PREFIX}0`)).toBe(0);
    expect(bandRunIndex(`${BAND_WALL_PREFIX}12`)).toBe(12);
    expect(bandRunIndex(`${FLOOR_WALL_PREFIX}0`)).toBeNull();
    expect(bandRunIndex('wall-abc')).toBeNull();
    expect(bandRunIndex(`${BAND_WALL_PREFIX}1.5`)).toBeNull();
    // And the two prefixes never answer for each other.
    expect(floorRingIndex(`${BAND_WALL_PREFIX}0`)).toBeNull();
  });
});
