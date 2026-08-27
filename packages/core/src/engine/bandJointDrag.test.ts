// The band editor's wiring: solver in, one undo entry out.
//
// bandSolver.test.ts already holds the geometry to the acceptance gates. What is
// left is everything between it and the map — which children get reused, which
// get added or removed, that the patches are complete enough for undo to be
// exact, and that a refusal writes nothing at all. Run against the shipped
// Warren and the real gg-demo manifest, because a fixture would only prove the
// test agrees with itself.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { caveBandPieces, jointsOf } from '../assets/caveWallKit';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import type { RingTangents } from '../shared/bezier';
import type { AnyChild, AssetChild, DungeonLayer, Layer, ShapeChild } from '../store/types';
import { getAssetPackManager, resetAssetPackManager } from './assetPackInstance';
import type { PackManifest } from './assetPackManager';
import { bandJointDrag, rewalkWholeBand, straightenBandJoints } from './bandJointDrag';
import { buildBandCommit, floorRingForBand } from './bandCommit';
import { solveBandDrag, type BandSolution } from './bandSolver';
import { detectBands, type CaveBand, type Vec } from './caveBand';
import {
  activeEditableRun,
  bandJointIndex,
  bandJointT,
  currentWallNodes,
  setBandTransientT,
  type EditableRun,
} from './wallNodeOverlay';

const REPO = resolve(process.cwd(), '../..');

beforeAll(() => {
  resetAssetPackManager();
  const dir = resolve(REPO, 'canvas/public/packs/gg-demo');
  const file = readdirSync(dir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))!;
  const manifest = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as PackManifest;
  const manager = getAssetPackManager();
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set(
    'gg-demo',
    manifest,
  );
  manager.catalogVersion++;
});

// Parsed once: 271 children and a 256-point ring, and every case wants its own
// untouched copy of them.
let warrenChildren: DungeonLayer['children'] | null = null;
function warrenSource(): DungeonLayer['children'] {
  if (!warrenChildren) {
    const map = JSON.parse(
      readFileSync(resolve(REPO, 'session/testdata/goblin-warren.mapbuilder'), 'utf8'),
    ) as { layers: Layer[] };
    warrenChildren = map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!.children;
  }
  return warrenChildren;
}

const layer = (): DungeonLayer =>
  useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;

/** The shipped cave in the store, in band edit mode on its one closed band. */
function seedWarren(): DungeonLayer {
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    children: structuredClone(warrenSource()),
    // A cave ships no wall texture set: its walls ARE the rock children.
    style: { ...l.style, wallTextureSetId: undefined },
  } as Partial<DungeonLayer>);
  useStore.getState().setNodeEditWall('band:0');
  return layer();
}

const bandRun = (): EditableRun & { kind: 'band' } => {
  const run = activeEditableRun();
  if (run?.kind !== 'band') throw new Error('not in band edit mode');
  return run;
};

const assets = (l: DungeonLayer): AssetChild[] =>
  l.children.filter((c): c is AssetChild => c.childType === 'asset');

const floorRing = (l: DungeonLayer): [number, number][] =>
  (l.children.find((c): c is ShapeChild => c.childType === 'shape')!).contours[0];

const status = () => useStore.getState().tools.bandDragStatus;

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Every seam of a band as it now stands on the map, in cells. */
function seams(band: CaveBand): number[] {
  const ends = band.pieces.map((p) => jointsOf(p.piece, p.at));
  const out: number[] = [];
  for (let m = 0; m < ends.length - (band.closed ? 0 : 1); m++)
    out.push(dist(ends[m][1], ends[(m + 1) % ends.length][0]));
  return out;
}

/** The void side at a joint — the direction a drag has to pull to widen the cave. */
function outward(band: CaveBand, m: number, pull: number): Vec {
  const n = band.joints.length;
  const a = band.joints[(m - 1 + n) % n];
  const b = band.joints[(m + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [
    band.joints[m][0] + ((b[1] - a[1]) / len) * pull,
    band.joints[m][1] - ((b[0] - a[0]) / len) * pull,
  ];
}

/** Press, drag by `pull` cells into the void, release. Answers where it aimed. */
function dragJoint(joint: number, pull: number): Vec {
  const run = bandRun();
  const to = outward(run.band, joint, pull);
  useStore.getState().selectNode(bandJointT(joint, run.band.joints.length));
  bandJointDrag({ phase: 'begin', run, ts: [bandJointT(joint, run.band.joints.length)] });
  // Two moves, the way a real gesture arrives: the second must be measured from
  // the ORIGIN, not compounded onto the first.
  const dx = to[0] - run.band.joints[joint][0];
  const dy = to[1] - run.band.joints[joint][1];
  bandJointDrag({ phase: 'move', dx: dx / 2, dy: dy / 2 });
  bandJointDrag({ phase: 'move', dx: dx / 2, dy: dy / 2 });
  bandJointDrag({ phase: 'end' });
  return to;
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  setBandTransientT(null);
});

describe('buildBandCommit', () => {
  /** A solution and the band it was solved against, on the seeded warren. */
  function solveAt(joint: number, pull = 0.5): { band: CaveBand; solution: BandSolution } {
    const l = seedWarren();
    const band = detectBands(l)[0];
    const result = solveBandDrag({
      contour: floorRing(l),
      band,
      joint,
      to: outward(band, joint, pull),
      set: caveBandPieces(),
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return { band, solution: result };
  }

  const build = (band: CaveBand, solution: BandSolution) => {
    const l = layer();
    const floor = floorRingForBand(l, band)!;
    return buildBandCommit({
      layerId: l.id,
      children: l.children,
      floor: { id: floor.child.id, contours: floor.child.contours, ring: floor.ring },
      band,
      solution,
      label: 'Move cave wall',
    });
  };

  it('reuses the spanered ids in walk order, across the seam of a closed band', () => {
    // Joint 0 of a closed band: the span runs backwards past index 0 and round
    // to the end of the children list, which is the case a slice would get wrong.
    const { band, solution } = solveAt(0);
    expect(solution.from + solution.count).toBeGreaterThan(band.pieces.length);

    const want = Array.from(
      { length: solution.count },
      (_, m) => band.pieces[(solution.from + m) % band.pieces.length].childId,
    );
    const before = new Map(assets(layer()).map((c) => [c.id, structuredClone(c)]));

    undoManager.execute(build(band, solution)!);

    // Every reused id still exists and now stands where the walk put it.
    const after = new Map(assets(layer()).map((c) => [c.id, c]));
    for (const [m, id] of want.slice(0, solution.pieces.length).entries()) {
      const child = after.get(id);
      expect(child, `piece ${m} kept its id`).toBeDefined();
      expect(child!.position.x).toBeCloseTo(solution.pieces[m].at.position.x, 9);
      expect(child!.position.y).toBeCloseTo(solution.pieces[m].at.position.y, 9);
      expect(child!.rotation).toBeCloseTo(solution.pieces[m].at.rotation, 9);
      expect(child!.scale).toBeCloseTo(solution.pieces[m].at.scale, 9);
      expect(child!.flipY).toBe(solution.pieces[m].at.flipY ?? false);
    }
    // And nothing outside the span moved at all.
    for (const [id, was] of before) {
      if (want.includes(id)) continue;
      expect(after.get(id), `${id} untouched`).toEqual(was);
    }
  });

  it('adds and removes only the difference in piece count', () => {
    const { band, solution } = solveAt(36, 1.2);
    const was = assets(layer()).length;
    undoManager.execute(build(band, solution)!);
    expect(assets(layer()).length).toBe(was + solution.pieces.length - solution.count);
  });

  it('patches every placement field, in both halves of the pair', () => {
    // The store's updateChild is a shallow Object.assign, so a field missing
    // from a patch silently keeps its old value — which on undo is a stone left
    // half-rewound. Proved by rewinding to a deliberately mangled child: if the
    // patch names the field, undo puts the mangled value back.
    const { band, solution } = solveAt(50);
    const id = band.pieces[solution.from].childId;
    const mangled: Partial<AssetChild> = {
      name: 'scratched',
      assetId: 'gg-demo:crate_1_1x1_A',
      position: { x: -99, y: -99 },
      rotation: 1.234,
      scale: 0.5,
      width: 7,
      height: 9,
      tint: '#ff0000',
      flipX: true,
      flipY: true,
    };
    useStore.getState().updateChild(layer().id, id, { ...mangled, visible: false });

    // Built against the band as it was solved but the children as they now are,
    // so `before` is the mangled state. Re-detecting here would find a different
    // band: the mangled piece has moved off the chain.
    undoManager.execute(build(band, solution)!);
    const laid = assets(layer()).find((c) => c.id === id)!;
    // Every field the patch names changed, so none of them is quietly untested.
    // Bar `tint`, which is carried forward from the child on purpose — a DM who
    // tinted a stretch of wall did not ask for a nudge to undo it — and is
    // proved to be in the patch by the rewind below instead.
    for (const key of Object.keys(mangled) as (keyof AssetChild)[]) {
      if (key === 'tint') continue;
      expect(laid[key], `${key} was overwritten`).not.toEqual(mangled[key]);
    }
    // `visible` is deliberately NOT in the patch: whether a DM has hidden a
    // stone is not part of where it sits.
    expect(laid.visible).toBe(false);

    useStore.getState().updateChild(layer().id, id, { tint: '#00ff00' });
    undoManager.undo();
    const back = assets(layer()).find((c) => c.id === id)!;
    for (const key of Object.keys(mangled) as (keyof AssetChild)[]) {
      expect(back[key], `${key} was rewound`).toEqual(mangled[key]);
    }
  });

  it('undoes and redoes the whole gesture as one entry', () => {
    const { band, solution } = solveAt(90, 0.8);
    const before = structuredClone(layer().children);
    undoManager.execute(build(band, solution)!);
    const after = structuredClone(layer().children);
    expect(after).not.toEqual(before);

    undoManager.undo();
    expect(layer().children).toEqual(before);
    undoManager.redo();
    expect(layer().children).toEqual(after);
  });
});

describe('a joint drag, end to end against the store', () => {
  it('moves the wall and the floor together, in one undoable step', () => {
    seedWarren();
    const before = structuredClone(layer().children);
    const ringBefore = structuredClone(floorRing(layer()));

    dragJoint(40, 0.5);

    expect(useStore.getState().ui.canUndo).toBe(true);
    expect(floorRing(layer())).not.toEqual(ringBefore);

    // Gate 1, measured on the map rather than on the solver's answer: still one
    // closed band, and no seam anywhere near a hole.
    const bands = detectBands(layer());
    expect(bands).toHaveLength(1);
    expect(bands[0].closed).toBe(true);
    expect(Math.max(...seams(bands[0]))).toBeLessThanOrEqual(0.9);
    expect(Math.min(...bands[0].pieces.map((p) => p.at.scale))).toBeGreaterThanOrEqual(0.88);
    expect(Math.max(...bands[0].pieces.map((p) => p.at.scale))).toBeLessThanOrEqual(1.12);

    // One entry: the whole gesture rewinds in a single press.
    undoManager.undo();
    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('writes nothing at all until the pointer comes up', () => {
    seedWarren();
    const run = bandRun();
    const before = structuredClone(layer().children);
    useStore.getState().selectNode(bandJointT(40, run.band.joints.length));
    const to = outward(run.band, 40, 0.5);
    const dx = to[0] - run.band.joints[40][0];
    const dy = to[1] - run.band.joints[40][1];

    bandJointDrag({ phase: 'begin', run, ts: [bandJointT(40, run.band.joints.length)] });
    bandJointDrag({ phase: 'move', dx: dx / 2, dy: dy / 2 });
    bandJointDrag({ phase: 'move', dx: dx / 2, dy: dy / 2 });

    // A contour write re-unions the map's floor, which is why the preview is
    // overlay-only — see bandJointDrag's header.
    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    // The solver's answer is reported all the same.
    expect(status()).toHaveProperty('kitPull');

    bandJointDrag({ phase: 'cancel' });
    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(status()).toBeNull();
  });

  it('names the pieces and the kit pull while the drag is live', () => {
    seedWarren();
    const run = bandRun();
    useStore.getState().selectNode(bandJointT(40, run.band.joints.length));
    const to = outward(run.band, 40, 0.5);
    bandJointDrag({ phase: 'begin', run, ts: [bandJointT(40, run.band.joints.length)] });
    bandJointDrag({
      phase: 'move',
      dx: to[0] - run.band.joints[40][0],
      dy: to[1] - run.band.joints[40][1],
    });

    const live = status();
    expect(live && 'pieces' in live).toBe(true);
    if (live && 'pieces' in live) {
      expect(live.pieces.length).toBeGreaterThan(0);
      expect(live.pieces.every((k) => k.length > 0)).toBe(true);
      expect(live.kitPull).toBeGreaterThanOrEqual(0);
    }
    // Cleared on release: it belongs to the gesture, not to the map.
    bandJointDrag({ phase: 'end' });
    expect(status()).toBeNull();
  });

  it('refuses an absurd drag, writes nothing, and is not poisoned by it', () => {
    seedWarren();
    const before = structuredClone(layer().children);

    // Fifteen cells inward: straight through the chamber and out the far wall.
    dragJoint(20, -15);

    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    const refused = status();
    expect(refused && 'refusal' in refused ? refused.refusal : '').toBe(
      'that would fold the floor outline through itself',
    );

    // And the next small drag still works: the refusal left no session behind.
    dragJoint(20, 0.5);
    expect(useStore.getState().ui.canUndo).toBe(true);
    expect(detectBands(layer())).toHaveLength(1);
  });

  it('drags the primary joint only, whatever else is selected', () => {
    seedWarren();
    const run = bandRun();
    const n = run.band.joints.length;
    const before = structuredClone(layer().children);
    // Two joints picked, the primary last — the group-drag shape.
    useStore.getState().selectNode(bandJointT(70, n));
    useStore.getState().toggleNodeSelection(bandJointT(40, n));

    bandJointDrag({ phase: 'begin', run, ts: [bandJointT(70, n), bandJointT(40, n)] });
    bandJointDrag({ phase: 'move', dx: 0.4, dy: 0.4 });
    bandJointDrag({ phase: 'end' });

    // Exactly one stretch was re-laid, and it is the primary's.
    const moved = assets(layer()).filter((c) => {
      const was = before.find((b) => b.id === c.id) as AssetChild | undefined;
      return !was || was.position.x !== c.position.x || was.position.y !== c.position.y;
    });
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThanOrEqual(12);
  });

  it('drags an inserted handle mid-span and lands one entry, then forgets it', () => {
    seedWarren();
    const run = bandRun();
    const n = run.band.joints.length;
    const before = structuredClone(layer().children);
    // What the insert gesture leaves behind: a fractional `t`, marked as the
    // gesture's own so it is not read as a `t` from a band that has changed
    // count. No store write has happened yet, and the band is untouched.
    const t = bandJointT(60.5, n);
    setBandTransientT(t);
    useStore.getState().selectNode(t);
    expect(layer().children).toEqual(before);
    expect(currentWallNodes()).toHaveLength(n + 1);

    const a = run.band.joints[60];
    const b = run.band.joints[61];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    bandJointDrag({ phase: 'begin', run, ts: [t] });
    bandJointDrag({
      phase: 'move',
      dx: ((b[1] - a[1]) / len) * 0.5,
      dy: (-(b[0] - a[0]) / len) * 0.5,
    });
    bandJointDrag({ phase: 'end' });

    expect(useStore.getState().ui.canUndo).toBe(true);
    const bands = detectBands(layer());
    expect(bands).toHaveLength(1);
    expect(bands[0].closed).toBe(true);
    expect(Math.max(...seams(bands[0]))).toBeLessThanOrEqual(0.9);

    // The handle was never a joint: once the walk has had its say the handles
    // are whatever detectBands now finds, and the transient one is gone.
    expect(useStore.getState().tools.selectedNodeT).toBeNull();
    expect(currentWallNodes()).toHaveLength(bands[0].joints.length);

    // Still one gesture, one entry.
    undoManager.undo();
    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('re-keys the handle onto the joint the walk landed, and drops the group', () => {
    seedWarren();
    const was = bandRun().band.joints.length;
    // Two joints picked, so the group is there to be dropped.
    useStore.getState().toggleNodeSelection(bandJointT(70, was));

    const to = dragJoint(40, 0.5);

    const band = detectBands(layer())[0];
    // The case the stale `t` broke: half the Warren's half-cell drags come back
    // with a different number of joints, and `index / count` then decodes to a
    // fraction — a transient insert handle a cell or two off the real joint.
    expect(band.joints.length).not.toBe(was);
    const t = useStore.getState().tools.selectedNodeT!;
    const at = bandJointIndex(t, band.joints.length);
    expect(Number.isInteger(at)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(band.joints.length);
    // And it is the joint the drag ended on: the one nearest where the pointer
    // went, no further from it than the kit pulls a handle.
    const nearest = band.joints.reduce(
      (best, p, m) => (dist(p, to) < dist(band.joints[best], to) ? m : best),
      0,
    );
    expect(at).toBe(nearest);
    expect(dist(band.joints[at], to)).toBeLessThan(1);
    // A whole `t` draws no transient handle, so the overlay is back to one per
    // joint rather than the stray it was showing a cell or two off the wall.
    expect(currentWallNodes()).toHaveLength(band.joints.length);
    // Every group `t` is stale the same way, so the group goes.
    expect(useStore.getState().tools.selectedNodeTs).toEqual([t]);

    // Which is what makes Delete mean straighten again: on the fractional `t` it
    // read as a transient handle and dropped the selection instead.
    const entries = structuredClone(layer().children);
    expect(straightenBandJoints(bandRun(), [t])).toBe(true);
    expect(layer().children).not.toEqual(entries);
    // Still a whole joint afterwards — the straighten re-keys too.
    const after = detectBands(layer())[0];
    const t2 = useStore.getState().tools.selectedNodeT!;
    expect(Number.isInteger(bandJointIndex(t2, after.joints.length))).toBe(true);
  });

  /**
   * The same staleness as the re-key above, on the undo path. `reselect` keys
   * the selection onto the band the commit landed; an undo or a redo then puts a
   * band with a DIFFERENT joint count back under that `t`, which decodes to a
   * fraction against the new count. Reading a fraction as a transient insert
   * handle is what made the next Delete a silent deselect.
   */
  it('keeps Delete meaning straighten after the drag is undone', () => {
    seedWarren();
    const was = bandRun().band.joints.length;
    dragJoint(40, 0.5);
    const landed = bandRun().band.joints.length;
    expect(landed).not.toBe(was);
    const t = useStore.getState().tools.selectedNodeT!;

    undoManager.undo();
    expect(bandRun().band.joints.length).toBe(was);
    // The `t` really is stale: live it was 121/126 decoded against 127 = 121.96.
    expect(t * was).not.toBe(Math.round(t * was));
    const at = bandJointIndex(t, was);
    expect(Number.isInteger(at)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(was);
    // So the overlay shows one handle per joint rather than a stray in a span.
    expect(currentWallNodes()).toHaveLength(was);

    // And Delete straightens — one entry, which the undo below takes back whole.
    const before = structuredClone(layer().children);
    expect(straightenBandJoints(bandRun(), [t])).toBe(true);
    expect(layer().children).not.toEqual(before);
    const band = detectBands(layer())[0];
    expect(band.closed).toBe(true);
    expect(Math.max(...seams(band))).toBeLessThanOrEqual(0.9);
    undoManager.undo();
    expect(layer().children).toEqual(before);
  });

  it('keeps Delete meaning straighten after the drag is redone', () => {
    seedWarren();
    const was = bandRun().band.joints.length;
    dragJoint(40, 0.5);
    const landed = bandRun().band.joints.length;
    undoManager.undo();

    // A joint picked on the band as it stands after the undo — nothing stale
    // about it until the redo moves the count under it again.
    const t = bandJointT(100, was);
    useStore.getState().selectNode(t);
    undoManager.redo();
    expect(bandRun().band.joints.length).toBe(landed);
    expect(t * landed).not.toBe(Math.round(t * landed));
    expect(Number.isInteger(bandJointIndex(t, landed))).toBe(true);
    expect(currentWallNodes()).toHaveLength(landed);

    const before = structuredClone(layer().children);
    expect(straightenBandJoints(bandRun(), [t])).toBe(true);
    expect(layer().children).not.toEqual(before);
    expect(Math.max(...seams(detectBands(layer())[0]))).toBeLessThanOrEqual(0.9);
  });

  it('treats a press that wobbles as the click it was', () => {
    seedWarren();
    const run = bandRun();
    const t = bandJointT(40, run.band.joints.length);
    useStore.getState().selectNode(t);
    const before = structuredClone(layer().children);

    // A twentieth of a cell — one pixel at a working zoom. The solver answers a
    // drag that small perfectly happily, with five or six stones re-laid and an
    // undo entry behind them, for a wall nobody can see move.
    bandJointDrag({ phase: 'begin', run, ts: [t] });
    bandJointDrag({ phase: 'move', dx: 0.03, dy: 0.04 });
    bandJointDrag({ phase: 'end' });

    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    // A click, so the selection is exactly where the DM left it.
    expect(useStore.getState().tools.selectedNodeT).toBe(t);
    expect(status()).toBeNull();

    // Half a cell is a drag, and lands.
    dragJoint(40, 0.5);
    expect(useStore.getState().ui.canUndo).toBe(true);
  });

  it('drops the gesture rather than commit onto a band that moved under it', () => {
    seedWarren();
    const run = bandRun();
    const n = run.band.joints.length;
    useStore.getState().selectNode(bandJointT(40, n));
    const to = outward(run.band, 40, 0.5);
    bandJointDrag({ phase: 'begin', run, ts: [bandJointT(40, n)] });
    bandJointDrag({
      phase: 'move',
      dx: to[0] - run.band.joints[40][0],
      dy: to[1] - run.band.joints[40][1],
    });

    // Something else edits the cave mid-drag. `band:0` is positional and the run
    // is re-derived from the children, so the id now names a different band.
    const victim = detectBands(layer())[0].pieces[5].childId;
    useStore.getState().removeChild(layer().id, victim);
    const before = structuredClone(layer().children);

    bandJointDrag({ phase: 'end' });

    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(status()).toHaveProperty('refusal');
  });
});

describe('straighten', () => {
  it('re-lays the stretch between the surviving joints, in one entry', () => {
    seedWarren();
    const run = bandRun();
    const before = structuredClone(layer().children);
    const n = run.band.joints.length;

    expect(straightenBandJoints(run, [bandJointT(60, n), bandJointT(61, n)])).toBe(true);

    expect(useStore.getState().ui.canUndo).toBe(true);
    const bands = detectBands(layer());
    expect(bands).toHaveLength(1);
    expect(bands[0].closed).toBe(true);
    expect(Math.max(...seams(bands[0]))).toBeLessThanOrEqual(0.9);
    // The count falls out of the walk rather than being asked for.
    expect(bands[0].joints.length).not.toBe(n);

    undoManager.undo();
    expect(layer().children).toEqual(before);
  });

  it('refuses a scattered selection and leaves the map alone', () => {
    seedWarren();
    const run = bandRun();
    const n = run.band.joints.length;
    const before = structuredClone(layer().children);

    expect(straightenBandJoints(run, [bandJointT(60, n), bandJointT(64, n)])).toBe(false);

    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(status()).toEqual({ refusal: 'those joints are not next to each other' });
  });
});

describe('re-walking the whole wall', () => {
  it('re-lays every piece from the outline and leaves the outline alone', () => {
    seedWarren();
    useStore.getState().selectNode(bandJointT(40, bandRun().band.joints.length));
    const ringBefore = structuredClone(floorRing(layer()));
    const was = detectBands(layer())[0].pieces.length;
    const before = structuredClone(layer().children);

    expect(rewalkWholeBand(bandRun())).toBe(true);

    expect(floorRing(layer())).toEqual(ringBefore);
    const bands = detectBands(layer());
    expect(bands).toHaveLength(1);
    expect(bands[0].closed).toBe(true);
    expect(Math.max(...seams(bands[0]))).toBeLessThanOrEqual(0.9);
    // The saved ring is the smooth curve simplified, so the re-walk lands near
    // but not on the count the generator laid over the curve itself.
    expect(bands[0].pieces.length).not.toBe(was);
    expect(Math.abs(bands[0].pieces.length - was)).toBeLessThan(20);
    // Every joint has been re-derived, so nothing that named one still does and
    // there is no landing point to re-key onto: the selection goes.
    expect(useStore.getState().tools.selectedNodeT).toBeNull();

    undoManager.undo();
    expect(layer().children).toEqual(before);
  });
});

describe('a band with no floor under it', () => {
  it('refuses with a reason rather than moving rock the outline cannot follow', () => {
    const l = seedWarren();
    // The rock without its outline: the shape child is what a drag would edit.
    const shape = l.children.find((c) => c.childType === 'shape')!;
    useStore.getState().removeChild(l.id, shape.id);
    const before = structuredClone(layer().children);

    dragJoint(40, 0.5);

    expect(layer().children).toEqual(before);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(status()).toEqual({
      refusal: 'this cave wall has no floor outline under it to move',
    });
  });

  it('refuses a curved ring rather than commit points the map does not draw', () => {
    const l = seedWarren();
    const shape = l.children.find((c): c is ShapeChild => c.childType === 'shape')!;
    const tangents: RingTangents = shape.contours[0].map(() => null);
    tangents[10] = { tin: [0.5, 0.5], tout: [-0.5, -0.5] };
    useStore.getState().updateChild(l.id, shape.id, { tangents: [tangents] } as Partial<AnyChild>);
    const before = structuredClone(layer().children);

    dragJoint(40, 0.5);

    expect(layer().children).toEqual(before);
    expect(status()).toEqual({
      refusal: 'that floor edge is curved — straighten it before re-laying the wall',
    });
  });
});
