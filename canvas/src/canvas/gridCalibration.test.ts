import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/toast', () => ({
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
  MIN_CELL_WORLD,
  applyGridCalibration,
  calibrationTransform,
  clampCells,
  endGridCalibration,
  getGridCalibration,
  latticeFixedSize,
  pxPerCell,
  setCalibrationCells,
  setCalibrationLattice,
  startGridCalibration,
  startLattice,
  type Lattice,
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

describe('startLattice', () => {
  it('starts on the detected grid, scaled onto the picture as placed', () => {
    // The printed squares are 105 px with lines 35 px in: 1.5 cells as placed, 0.5 in.
    const l = startLattice(image(), { cells: { width: 24, height: 16 }, grid: { pxPerCell: 105, originX: 35, originY: 35 }, sourcePx: SOURCE });
    expect(l.cell).toBeCloseTo(1.5, 9);
    expect(l.x).toBeCloseTo(0.5, 9);
    expect(l.y).toBeCloseTo(0.5, 9);
    expect([l.cols, l.rows]).toEqual([24, 16]);
  });

  it('reads a line found at the far end of a cell as the picture edge, so the lattice stays on it', () => {
    const l = startLattice(image(), { cells: { width: 36, height: 24 }, grid: { pxPerCell: 70, originX: 68, originY: 2 }, sourcePx: SOURCE });
    expect(l.x).toBeCloseTo(-2 / 70, 9);
    expect(l.y).toBeCloseTo(2 / 70, 9);
  });

  it('without a grid, spreads the squares across the picture from its corner', () => {
    const l = startLattice(image(), { cells: { width: 30, height: 20 } });
    expect(l).toEqual({ x: 0, y: 0, cell: 36 / 30, cols: 30, rows: 20 });
  });

  it('with nothing, starts on the map grid from the first line on the picture', () => {
    const l = startLattice(image({ position: { x: 17.7, y: 11.6 } }));
    expect(l.cell).toBe(1);
    expect(l.x).toBeCloseTo(0, 9);
    expect(l.y).toBeCloseTo(0, 9);
    expect([l.cols, l.rows]).toEqual([36, 24]);
  });
});

describe('calibrationTransform', () => {
  const lattice: Lattice = { x: 0.5, y: 0.25, cell: 1.5, cols: 23, rows: 15 };

  it('makes one lattice cell one map cell and puts the lattice corner on the map origin', () => {
    const t = calibrationTransform(image(), lattice)!;
    const k = 1 / 1.5;
    expect(t.width * 0.5).toBeCloseTo(36 * k, 9);
    expect(t.height * 0.5).toBeCloseTo(24 * k, 9);
    const left = t.position.x - (t.width * 0.5) / 2;
    const top = t.position.y - (t.height * 0.5) / 2;
    // Every lattice line lands on a whole map cell: the corner on 0, the tenth line on 10.
    expect((0.5 - 0) * k + left).toBeCloseTo(0, 9);
    expect((0.25 - 0) * k + top).toBeCloseTo(0, 9);
    expect((0.5 + 10 * 1.5) * k + left).toBeCloseTo(10, 9);
  });

  it('leaves the picture corner hanging the fraction of a cell it starts before the lattice', () => {
    const t = calibrationTransform(image(), lattice)!;
    expect(t.position.x - (t.width * 0.5) / 2).toBeCloseTo(-0.5 / 1.5, 9);
  });

  it('is a no-op for a picture already lined up', () => {
    const t = calibrationTransform(image(), { x: 0, y: 0, cell: 1, cols: 36, rows: 24 })!;
    expect(t.position).toEqual({ x: 18, y: 12 });
    expect(t.width).toBe(72);
  });

  it('refuses a degenerate lattice, a zero picture, or a result off the scale', () => {
    expect(calibrationTransform(image(), { ...lattice, cell: 0 })).toBeNull();
    expect(calibrationTransform(image(), { ...lattice, cell: MIN_CELL_WORLD / 2 })).toBeNull();
    expect(calibrationTransform(image(), { ...lattice, x: NaN })).toBeNull();
    expect(calibrationTransform(image({ width: 0 }), lattice)).toBeNull();
    expect(calibrationTransform(image(), { ...lattice, cell: 100 })).toBeNull();
    // Past MIN_CELL_WORLD but a picture over ten thousand cells across.
    expect(calibrationTransform(image(), { ...lattice, cell: 0.03 })).not.toBeNull();
    expect(calibrationTransform({ ...image(), width: 800 }, { ...lattice, cell: 0.03 })).toBeNull();
  });
});

describe('latticeFixedSize and clampCells', () => {
  it('is the lattice in whole cells, within what a fixed size accepts', () => {
    expect(latticeFixedSize({ cols: 36, rows: 24 })).toEqual({ width: 36, height: 24 });
    expect(clampCells(0)).toBe(1);
    expect(clampCells(NaN)).toBe(1);
    expect(clampCells(12.4)).toBe(12);
    expect(clampCells(5000)).toBe(1000);
  });
});

describe('pxPerCell', () => {
  it('reads the picture’s own pixels, not the downscaled texture’s', () => {
    // A 5040 px original shrunk to a 2048 texture, placed 36 cells wide: 140 px a cell.
    expect(pxPerCell({ cell: 1 }, 36, 5040)).toBeCloseTo(140, 9);
  });

  it('reads degenerate input as null, never NaN or Infinity', () => {
    expect(pxPerCell({ cell: 0 }, 36, 5040)).toBeNull();
    expect(pxPerCell({ cell: 1 }, 0, 5040)).toBeNull();
    expect(pxPerCell({ cell: 1 }, 36, 0)).toBeNull();
    expect(pxPerCell({ cell: NaN }, 36, 5040)).toBeNull();
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

describe('grid line-up session', () => {
  beforeEach(() => {
    endGridCalibration();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addChild(layer().id, image({ imageSource: { fileName: 'crypt.png', ...SOURCE } }));
  });

  it('refuses to start on an id that is not an asset child', () => {
    expect(startGridCalibration('nope')).toBe(false);
    expect(getGridCalibration()).toBeNull();
  });

  it('measures against the picture’s own source size when the caller gives none', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 }, grid: { pxPerCell: 105, originX: 35, originY: 35 } });
    expect(getGridCalibration()!.sourcePx).toEqual(SOURCE);
    expect(getGridCalibration()!.lattice.cell).toBeCloseTo(1.5, 9);
  });

  it('reflows W and H from the corner, in whole cells', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    setCalibrationCells(25, 0);
    expect(getGridCalibration()!.lattice).toMatchObject({ x: 0, y: 0, cols: 25, rows: 1 });
  });

  it('takes the grid as one undo step: picture, fixed size, lock; then undoes all three', () => {
    startGridCalibration('img', { cells: { width: 24, height: 16 } });
    setCalibrationLattice({ x: 0.5, y: 0.25, cell: 1.5 });
    setCalibrationCells(23, 15);

    expect(applyGridCalibration()).toBe(true);
    expect(getGridCalibration()).toBeNull();
    const after = placed();
    expect(after.width * after.scale).toBeCloseTo(24, 9);
    expect(after.position.x - (after.width * after.scale) / 2).toBeCloseTo(-1 / 3, 9);
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 23, height: 15 });
    expect(layer().locked).toBe(true);

    undoManager.undo();
    expect(placed()).toEqual(image({ imageSource: { fileName: 'crypt.png', ...SOURCE } }));
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
    expect(layer().locked).toBe(false);
    expect(undoManager.canRedo()).toBe(true);
  });

  it('refuses an impossible lattice and stays in the mode', () => {
    startGridCalibration('img');
    // A lattice cell bigger than the whole picture would shrink it below half a cell.
    setCalibrationLattice({ x: 0, y: 0, cell: 100 });

    expect(applyGridCalibration()).toBe(false);
    expect(getGridCalibration()).not.toBeNull();
    expect(layer().locked).toBe(false);
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
    expect(undoManager.canUndo()).toBe(false);
  });

  it('Skip leaves the image as placed, unlocked, and the size alone', () => {
    startGridCalibration('img');
    setCalibrationLattice({ x: 2, y: 2, cell: 0.5 });
    endGridCalibration();

    expect(getGridCalibration()).toBeNull();
    expect(placed()).toEqual(image({ imageSource: { fileName: 'crypt.png', ...SOURCE } }));
    expect(layer().locked).toBe(false);
    expect(useStore.getState().mapSettings.fixedSize).toBeNull();
    expect(undoManager.canUndo()).toBe(false);
  });
});
