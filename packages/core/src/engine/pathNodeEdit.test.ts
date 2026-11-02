import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import type { DungeonLayer } from '../store/types';
import type { PathChild } from '../shared/types';
import {
  editedPath,
  endPathDrag,
  hoverPath,
  movePathDrag,
  pathHitAt,
  pressPath,
  removeHoveredPathPoint,
  togglePathPointAt,
  wheelPath,
} from './pathNodeEdit';
import { pickAt, getChildBounds } from './hitTest';
import { snapshotChild, transformChild } from './tools/childTransform';
import { computeContentBounds } from '../shared/mapBounds';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

/** Zoom 50: a 10px pick is 0.2 cells. */
const Z = 50;
const NO = { alt: false, shift: false };

const road = (over: Partial<PathChild> = {}): PathChild => ({
  id: 'road',
  name: 'Road',
  childType: 'path',
  visible: true,
  points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }],
  closed: false,
  width: 2,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0,
  flip: false,
  edge: 'soft',
  ends: { start: 'cut', end: 'cut', length: 1 },
  sort: 'under',
  ...over,
});

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const now = () => layer().children.find((c) => c.id === 'road') as PathChild;

function seed(over: Partial<PathChild> = {}) {
  useStore.getState().addChild(layer().id, road(over));
  useStore.getState().setActiveTool('select');
  useStore.getState().setSelectedIds(['road']);
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  useStore.setState((s) => {
    s.grid.snapEnabled = false;
  });
});

describe('which path is edited', () => {
  it('is the one selected path, with the Select tool, unlocked and shown', () => {
    seed();
    expect(editedPath()?.path.id).toBe('road');
    useStore.getState().setActiveTool('path');
    expect(editedPath()).toBeNull();
    useStore.getState().setActiveTool('select');
    useStore.getState().updateChild(layer().id, 'road', { locked: true });
    expect(editedPath()).toBeNull();
  });
});

describe('hits', () => {
  beforeEach(() => seed());

  it('finds points, width handles and the centreline, in that order', () => {
    expect(pathHitAt({ x: 4.05, y: 0 }, Z)).toEqual({ kind: 'point', index: 1 });
    // The width handle sits half the width off the point, across the path.
    expect(pathHitAt({ x: 4, y: 1 }, Z)).toEqual({ kind: 'width', index: 1 });
    expect(pathHitAt({ x: 6, y: 0.1 }, Z)).toMatchObject({ kind: 'insert', index: 2 });
    expect(pathHitAt({ x: 6, y: 0.6 }, Z)).toBeNull();
  });

  it('shows ± per point only in Set height mode', () => {
    expect(pathHitAt({ x: 4, y: -18 / Z }, Z)?.kind).not.toBe('height');
    useStore.getState().updateChild(layer().id, 'road', { heightMode: 'set' });
    expect(pathHitAt({ x: 4, y: -18 / Z }, Z)).toEqual({ kind: 'height', index: 1, dir: 1 });
    expect(pressPath({ x: 4, y: -18 / Z }, Z, NO)).toBe(true);
    expect(pressPath({ x: 4, y: -18 / Z }, Z, NO)).toBe(true);
    expect(pressPath({ x: 4, y: 18 / Z }, Z, NO)).toBe(true);
    expect(now().points[1].height).toBe(1);
  });
});

describe('gestures, one undo entry each', () => {
  beforeEach(() => seed());

  it('drags a point', () => {
    expect(pressPath({ x: 4, y: 0 }, Z, NO)).toBe(true);
    movePathDrag({ x: 4, y: 1 });
    movePathDrag({ x: 4.5, y: 2 });
    expect(now().points[1]).toEqual({ x: 4.5, y: 2 });
    endPathDrag();
    undoManager.undo();
    expect(now().points[1]).toEqual({ x: 4, y: 0 });
    expect(undoManager.canUndo()).toBe(false);
  });

  it('Alt-drags handles out of a point, mirrored', () => {
    pressPath({ x: 4, y: 0 }, Z, { alt: true, shift: false });
    movePathDrag({ x: 5, y: 1 });
    endPathDrag();
    expect(now().points[1].handles).toEqual({ in: [-1, -1], out: [1, 1] });
    // Then the out handle on its own: the in handle stays put.
    pressPath({ x: 5, y: 1 }, Z, NO);
    movePathDrag({ x: 6, y: 0 });
    endPathDrag();
    expect(now().points[1].handles).toEqual({ in: [-1, -1], out: [2, 0] });
  });

  it('drags a width handle across the path, and Shift scales every width', () => {
    pressPath({ x: 4, y: 1 }, Z, NO);
    movePathDrag({ x: 4, y: 1.5 });
    endPathDrag();
    expect(now().points[1].width).toBe(3);
    pressPath({ x: 0, y: 1 }, Z, { alt: false, shift: true });
    movePathDrag({ x: 0, y: 2 });
    endPathDrag();
    expect(now().width).toBe(4);
    expect(now().points[1].width).toBe(6);
    undoManager.undo();
    expect(now().width).toBe(2);
    expect(now().points[1].width).toBe(3);
  });

  it('a click on the centreline adds a point there', () => {
    pressPath({ x: 6, y: 0.05 }, Z, NO);
    expect(now().points.map((p) => p.x)).toEqual([0, 4, 6, 8]);
    undoManager.undo();
    expect(now().points).toHaveLength(3);
  });

  it('a press away from the path is not the path’s', () => {
    expect(pressPath({ x: 4, y: 5 }, Z, NO)).toBe(false);
  });
});

describe('wheel, double-click, Delete', () => {
  beforeEach(() => seed());

  it('the wheel over a point steps its width', () => {
    expect(wheelPath({ x: 4, y: 0 }, Z, -100, false)).toBe(true);
    expect(wheelPath({ x: 4, y: 0 }, Z, -100, false)).toBe(true);
    expect(now().points[1].width).toBe(2.5);
    expect(wheelPath({ x: 4, y: 0 }, Z, 100, true)).toBe(true);
    expect(now().points[1].width).toBe(2.45);
    expect(wheelPath({ x: 4, y: 5 }, Z, -100, false)).toBe(false);
  });

  it('a double-click on a point turns it sharp, and again turns it back', () => {
    expect(togglePathPointAt({ x: 4, y: 0 }, Z)).toBe(true);
    expect(now().points[1].handles).toBeNull();
    togglePathPointAt({ x: 4, y: 0 }, Z);
    expect(now().points[1]).not.toHaveProperty('handles');
    expect(togglePathPointAt({ x: 6, y: 3 }, Z)).toBe(false);
  });

  it('Delete on a hovered point removes it, never below two', () => {
    hoverPath({ x: 4, y: 0 }, Z);
    expect(removeHoveredPathPoint()).toBe(true);
    expect(now().points.map((p) => p.x)).toEqual([0, 8]);
    hoverPath({ x: 6, y: 5 }, Z);
    expect(removeHoveredPathPoint()).toBe(false);
  });
});

describe('a path elsewhere in the editor', () => {
  it('picks on its ribbon, and a filled lake on its inside', () => {
    seed();
    expect(pickAt([4, 0.9], { zoom: Z })?.id).toBe('road');
    expect(pickAt([4, 1.5], { zoom: Z })?.id).not.toBe('road');
    const lake = road({
      id: 'lake',
      closed: true,
      fill: true,
      points: [{ x: 20, y: 0, handles: null }, { x: 30, y: 0, handles: null }, { x: 30, y: 10, handles: null }, { x: 20, y: 10, handles: null }],
    });
    useStore.getState().addChild(layer().id, lake);
    expect(pickAt([25, 5], { zoom: Z })?.id).toBe('lake');
    useStore.getState().updateChild(layer().id, 'lake', { fill: false });
    expect(pickAt([25, 5], { zoom: Z })?.id).not.toBe('lake');
  });

  it('counts toward the map bounds, grown by its widest half-width', () => {
    seed({ points: [{ x: 0, y: 0 }, { x: 8, y: 0, width: 4 }] });
    const b = computeContentBounds(useStore.getState().layers, null)!;
    expect(b.minX).toBeLessThanOrEqual(-2);
    expect(b.maxX).toBeGreaterThanOrEqual(10);
    expect(getChildBounds(now())).toMatchObject({ y: -2, height: 4 });
  });

  it('moves and turns as a whole, its handles turning with it', () => {
    const p = road({ points: [{ x: 0, y: 0, handles: { in: [-1, 0], out: [1, 0] } }, { x: 4, y: 0 }] });
    const snap = snapshotChild(p);
    const quarter = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: Math.PI / 2, anchorX: 0, anchorY: 0 };
    const out = transformChild(snap, quarter) as Partial<PathChild>;
    const [a, b] = out.points!;
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(4, 6);
    expect(a.handles!.out[0]).toBeCloseTo(0, 6);
    expect(a.handles!.out[1]).toBeCloseTo(1, 6);
  });
});
