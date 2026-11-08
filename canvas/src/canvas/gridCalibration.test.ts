import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dnd/ui/toast', () => ({
  notify: {
    subtle: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer } from '@/store/types';
import {
  applyGridCalibration,
  clampCells,
  clampPxPerCell,
  endGridCalibration,
  getGridCalibration,
  lineUpBox,
  lineUpFixedSize,
  lineUpPlacement,
  mapHoldsOtherContent,
  nudgeCalibration,
  pxPerCellRange,
  setCalibrationCells,
  setCalibrationOffset,
  setCalibrationPxPerCell,
  startGridCalibration,
  startLineUp,
} from './gridCalibration';

/**
 * A 2520 by 1680 px battlemap imported at the 70 px guess: a 36 by 24 cell footprint
 * (width * scale, the number the sprite sync and the hit test use) with its top-left corner
 * on the map origin. `scale` is 0.5 to keep the legacy multiplier honest.
 */
function image(over: Partial<AssetChild> = {}): AssetChild {
  return {
    id: 'img',
    name: 'Battlemap',
    childType: 'asset',
    visible: true,
    objectType: 'image',
    assetId: 'asset-1',
    position: { x: 18, y: 12 },
    rotation: 0,
    scale: 0.5,
    width: 72,
    height: 48,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

const SOURCE = { width: 2520, height: 1680 };
/** 105 px squares with their lines 35 px in: a third of a cell. */
const GRID = { pxPerCell: 105, originX: 35, originY: 35 };

describe('startLineUp', () => {
  it('takes the detected squares, one printed cell to one canvas cell, the first line on the frame edge', () => {
    const l = startLineUp(image(), { cells: { width: 24, height: 16 }, grid: GRID, sourcePx: SOURCE });
    expect(l).toMatchObject({ cols: 24, rows: 16, pxPerCell: 105 });
    // The picture hangs a third of a cell past the frame's top-left, so its line is on 0.
    expect(l.offsetX).toBeCloseTo(-1 / 3, 9);
    expect(l.offsetY).toBeCloseTo(-1 / 3, 9);
  });

  it('reads a line found at the far end of a cell as the picture edge, keeping the picture on the frame', () => {
    const l = startLineUp(image(), { cells: { width: 24, height: 16 }, grid: { ...GRID, originX: 100 }, sourcePx: SOURCE });
    expect(l.offsetX).toBeCloseTo(5 / 105, 9);
  });

  it('without a grid, spreads the squares across the picture from the origin', () => {
    expect(startLineUp(image(), { cells: { width: 24, height: 16 }, sourcePx: SOURCE })).toEqual({ cols: 24, rows: 16, pxPerCell: 105, offsetX: 0, offsetY: 0 });
  });

  it('with nothing, keeps the scale the picture is placed at and its whole cells', () => {
    expect(startLineUp(image(), { sourcePx: SOURCE })).toEqual({ cols: 36, rows: 24, pxPerCell: 70, offsetX: 0, offsetY: 0 });
  });

  it('over drawn work: puts the first line on the nearest grid line and keeps a pinned size', () => {
    const moved = image({ position: { x: 2.6 + 18, y: 3.3 + 12 } });
    const pinned = startLineUp(moved, { grid: GRID, sourcePx: SOURCE }, 'nearest', { width: 40, height: 30 });
    expect(pinned.offsetX).toBeCloseTo(3 - 1 / 3, 9);
    expect(pinned.offsetY).toBeCloseTo(4 - 1 / 3, 9);
    expect(pinned).toMatchObject({ cols: 40, rows: 30 });
    // Unpinned: the frame starts round the picture.
    expect(startLineUp(moved, { grid: GRID, sourcePx: SOURCE }, 'nearest', null)).toMatchObject({ cols: 27, rows: 20 });
  });
});

describe('lineUpPlacement', () => {
  it('scales the picture to source / px per cell, keeping its aspect, its corner on the offset', () => {
    const p = lineUpPlacement(image(), SOURCE, { offsetX: -1 / 3, offsetY: 0.5, pxPerCell: 105 })!;
    expect(p.width * 0.5).toBeCloseTo(24, 9);
    expect(p.height * 0.5).toBeCloseTo(16, 9);
    expect(p.position.x - 12).toBeCloseTo(-1 / 3, 9);
    expect(p.position.y - 8).toBeCloseTo(0.5, 9);
  });

  it('is a no-op for a picture already lined up', () => {
    expect(lineUpPlacement(image(), SOURCE, { offsetX: 0, offsetY: 0, pxPerCell: 70 })).toEqual({ position: { x: 18, y: 12 }, width: 72, height: 48 });
  });

  it('refuses a picture of no size or a broken offset', () => {
    expect(lineUpPlacement(image({ width: 0 }), SOURCE, { offsetX: 0, offsetY: 0, pxPerCell: 70 })).toBeNull();
    expect(lineUpPlacement(image(), SOURCE, { offsetX: NaN, offsetY: 0, pxPerCell: 70 })).toBeNull();
  });
});

describe('px per cell bounds and whole cells', () => {
  it('keeps the picture between half a cell and the largest map, never NaN', () => {
    expect(pxPerCellRange(SOURCE)).toEqual({ min: 1, max: 3360 });
    expect(clampPxPerCell(0, SOURCE)).toBe(1);
    expect(clampPxPerCell(1e6, SOURCE)).toBe(3360);
    expect(clampPxPerCell(NaN, SOURCE)).toBe(2520);
  });

  it('is the frame in whole cells, within what a fixed size accepts', () => {
    expect(lineUpFixedSize({ cols: 12.4, rows: 0 })).toEqual({ width: 12, height: 1 });
    expect(clampCells(5000)).toBe(1000);
    expect(clampCells(NaN)).toBe(1);
  });
});

// ─── Session + apply ─────────────────────────────────────

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function placed(): AssetChild {
  const c = layer().children.find((x) => x.id === 'img');
  if (!c || c.childType !== 'asset') throw new Error('image gone');
  return c;
}

const left = (c: AssetChild) => c.position.x - (c.width * c.scale) / 2;
const top = (c: AssetChild) => c.position.y - (c.height * c.scale) / 2;
const original = () => image({ imageSource: { fileName: 'crypt.png', ...SOURCE } });

describe('mapHoldsOtherContent', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('is false for a map holding only the picture, true once a wall is drawn', () => {
    useStore.getState().addChild(layer().id, image());
    expect(mapHoldsOtherContent(useStore.getState().layers, 'img')).toBe(false);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.standaloneWalls.push({ id: 'w', points: [[0, 0], [4, 0]] } as DungeonLayer['standaloneWalls'][number]);
    });
    expect(mapHoldsOtherContent(useStore.getState().layers, 'img')).toBe(true);
  });
});

describe('grid line-up session', () => {
  beforeEach(() => {
    endGridCalibration();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setGridVisible(false);
    useStore.getState().addChild(layer().id, original());
  });

  it('refuses to start on an id that is not an asset child', () => {
    expect(startGridCalibration('nope')).toBe(false);
    expect(getGridCalibration()).toBeNull();
  });

  it('writes the start at once: the picture on the grid, the frame W by H, Show grid on, no undo step', () => {
    expect(startGridCalibration('img', { cells: { width: 24, height: 16 }, grid: GRID })).toBe(true);
    // The picture's own source size, when the caller gives none.
    expect(getGridCalibration()!.sourcePx).toEqual(SOURCE);
    expect(placed().width * placed().scale).toBeCloseTo(24, 9);
    expect(left(placed())).toBeCloseTo(-1 / 3, 9);
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 24, height: 16 });
    expect(useStore.getState().grid.visible).toBe(true);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('W and H are the map size, live; the picture keeps its scale and place', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    setCalibrationCells(25, 0);
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 25, height: 1 });
    expect(placed().width * placed().scale).toBeCloseTo(24, 9);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('px per cell rescales about the picture’s corner; a drag or nudge moves the corner', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    setCalibrationOffset(0.5, 0.25);
    setCalibrationPxPerCell(52.5);
    expect(placed().width * placed().scale).toBeCloseTo(48, 9);
    expect(placed().height * placed().scale).toBeCloseTo(32, 9);
    expect(left(placed())).toBeCloseTo(0.5, 9);
    expect(top(placed())).toBeCloseTo(0.25, 9);
    nudgeCalibration(-0.05, 0.25);
    expect(left(placed())).toBeCloseTo(0.45, 9);
    expect(top(placed())).toBeCloseTo(0.5, 9);
    expect(lineUpBox(getGridCalibration()!)).toMatchObject({ left: 0.45, top: 0.5 });
    expect(lineUpBox(getGridCalibration()!)!.width).toBeCloseTo(48, 9);
  });

  it('takes the grid as one undo step: picture, fixed size, lock; Show grid goes back; undo restores all', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    setCalibrationOffset(-1 / 3, 0);
    setCalibrationCells(23, 15);

    expect(applyGridCalibration()).toBe(true);
    expect(getGridCalibration()).toBeNull();
    const after = placed();
    expect(after.width * after.scale).toBeCloseTo(24, 9);
    expect(left(after)).toBeCloseTo(-1 / 3, 9);
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 23, height: 15 });
    expect(layer().locked).toBe(true);
    expect(useStore.getState().grid.visible).toBe(false);

    undoManager.undo();
    expect(placed()).toEqual(original());
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
    expect(layer().locked).toBe(false);
    expect(undoManager.canUndo()).toBe(false);
    expect(undoManager.canRedo()).toBe(true);
  });

  it('a re-line-up over drawn work keeps the picture on a grid line and the pinned size', () => {
    useStore.getState().setFixedSize({ width: 40, height: 30 });
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.standaloneWalls.push({ id: 'w', points: [[1, 1], [5, 1]] } as DungeonLayer['standaloneWalls'][number]);
    });
    useStore.getState().updateChild(layer().id, 'img', { position: { x: 18 + 2.6, y: 12 + 3.3 } });
    startGridCalibration('img', { grid: GRID });
    expect(getGridCalibration()!.anchor).toBe('nearest');
    expect(applyGridCalibration()).toBe(true);
    const after = placed();
    // The printed line a third of a cell in lands on a whole cell.
    expect(left(after) + 1 / 3).toBeCloseTo(3, 9);
    expect(top(after) + 1 / 3).toBeCloseTo(4, 9);
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 40, height: 30 });
    // The layer holds a wall too, so only the picture locks.
    expect(layer().locked).toBe(false);
    expect(after.locked).toBe(true);
  });

  it('Skip puts the picture, the size and Show grid back, unlocked, with no undo step', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 }, grid: GRID });
    setCalibrationOffset(2, 2);
    setCalibrationPxPerCell(50);
    setCalibrationCells(10, 10);
    endGridCalibration();

    expect(getGridCalibration()).toBeNull();
    expect(placed()).toEqual(original());
    expect(layer().locked).toBe(false);
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
    expect(useStore.getState().grid.visible).toBe(false);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a picture gone from the map leaves the map alone on the way out', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    useStore.getState().resetToDefault();
    useStore.getState().setFixedSize({ width: 5, height: 5 });
    endGridCalibration();
    expect(getGridCalibration()).toBeNull();
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 5, height: 5 });
  });
});
