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
  MIN_BOX_WORLD,
  applyGridCalibration,
  calibrationTransform,
  clampSpans,
  endGridCalibration,
  getGridCalibration,
  pxPerCell,
  setCalibrationBox,
  setCalibrationSpans,
  startGridCalibration,
} from './gridCalibration';

/**
 * A 1000px-square image whose world footprint (width * scale, the number both
 * the sprite sync and the hit test use) is exactly 10 cells, centred on (5, 5).
 * Its top-left corner therefore sits on the world origin.
 */
function image(over: Partial<AssetChild> = {}): AssetChild {
  return {
    id: 'img',
    name: 'Battlemap',
    childType: 'asset',
    visible: true,
    objectType: 'image',
    assetId: 'asset-1',
    position: { x: 5, y: 5 },
    rotation: 0,
    scale: 0.5,
    width: 20,
    height: 20,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

describe('calibrationTransform', () => {
  it('scales so the box measures exactly `spans` cells', () => {
    // A box 1.5 cells across that the DM says covers 3 of the image's squares:
    // the image has to double in size.
    const t = calibrationTransform(image(), { x: 0, y: 0, size: 1.5 }, 3);
    expect(t).not.toBeNull();
    expect(t!.width * 0.5).toBeCloseTo(20, 6); // footprint 10 cells -> 20
    expect(t!.height * 0.5).toBeCloseTo(20, 6);
  });

  it('leaves the box top-left on a grid intersection, snapping to the nearest', () => {
    // Box at (2.3, 4.8): after the transform its corner must land on (2, 5).
    const child = image();
    const box = { x: 2.3, y: 4.8, size: 1 };
    const t = calibrationTransform(child, box, 1)!;
    const k = 1 / box.size;
    const newTopLeft = {
      x: t.position.x - (t.width * child.scale) / 2,
      y: t.position.y - (t.height * child.scale) / 2,
    };
    // Where the box corner ends up: the same point of the image, rescaled.
    const boxOffsetInImage = { x: box.x - 0, y: box.y - 0 }; // image corner is at world 0,0
    expect(newTopLeft.x + boxOffsetInImage.x * k).toBeCloseTo(2, 6);
    expect(newTopLeft.y + boxOffsetInImage.y * k).toBeCloseTo(5, 6);
  });

  it('is a no-op when the box already spans one whole cell on a lattice point', () => {
    const child = image();
    const t = calibrationTransform(child, { x: 3, y: 3, size: 1 }, 1)!;
    expect(t.position.x).toBeCloseTo(child.position.x, 6);
    expect(t.position.y).toBeCloseTo(child.position.y, 6);
    expect(t.width).toBeCloseTo(child.width, 6);
    expect(t.height).toBeCloseTo(child.height, 6);
  });

  it('divides the alignment error by the span count', () => {
    // The image is already correct (1 cell = 1 cell), so the ideal transform is
    // a no-op. Both boxes overshoot the far edge by the same 0.05 cells; the
    // 3-cell box carries a third of the error into the scale.
    const err = 0.05;
    const one = calibrationTransform(image(), { x: 0, y: 0, size: 1 + err }, 1)!;
    const three = calibrationTransform(image(), { x: 0, y: 0, size: 3 + err }, 3)!;
    const errOne = Math.abs(one.width / 20 - 1);
    const errThree = Math.abs(three.width / 20 - 1);
    expect(errThree).toBeLessThan(errOne / 2.5);
  });

  it('refuses a zero or near-zero box rather than exploding the sprite', () => {
    expect(calibrationTransform(image(), { x: 0, y: 0, size: 0 }, 1)).toBeNull();
    expect(calibrationTransform(image(), { x: 0, y: 0, size: -2 }, 1)).toBeNull();
    expect(calibrationTransform(image(), { x: 0, y: 0, size: MIN_BOX_WORLD / 2 }, 1)).toBeNull();
  });

  it('refuses non-finite geometry', () => {
    expect(calibrationTransform(image(), { x: NaN, y: 0, size: 1 }, 1)).toBeNull();
    expect(calibrationTransform(image(), { x: 0, y: Infinity, size: 1 }, 1)).toBeNull();
    expect(calibrationTransform(image(), { x: 0, y: 0, size: NaN }, 1)).toBeNull();
  });

  it('refuses a zero-footprint child', () => {
    expect(calibrationTransform(image({ scale: 0 }), { x: 0, y: 0, size: 1 }, 1)).toBeNull();
    expect(calibrationTransform(image({ width: 0 }), { x: 0, y: 0, size: 1 }, 1)).toBeNull();
  });

  it('refuses a result that would be smaller than half a cell or bigger than a continent', () => {
    // Box far bigger than the image: the image would shrink to nothing.
    expect(calibrationTransform(image(), { x: 0, y: 0, size: 400 }, 1)).toBeNull();
    // Smallest legal box called 64 cells: the image would blow past the ceiling.
    expect(calibrationTransform(image(), { x: 0, y: 0, size: MIN_BOX_WORLD }, 64)).toBeNull();
  });

  it('treats a nonsense span as one cell rather than dividing by zero', () => {
    const zero = calibrationTransform(image(), { x: 0, y: 0, size: 2 }, 0)!;
    const one = calibrationTransform(image(), { x: 0, y: 0, size: 2 }, 1)!;
    expect(zero.width).toBeCloseTo(one.width, 9);
    expect(calibrationTransform(image(), { x: 0, y: 0, size: 2 }, NaN)!.width).toBeCloseTo(
      one.width,
      9,
    );
    expect(calibrationTransform(image(), { x: 0, y: 0, size: 2 }, -5)!.width).toBeCloseTo(
      one.width,
      9,
    );
  });
});

describe('clampSpans', () => {
  it('keeps spans a whole number of at least one', () => {
    expect(clampSpans(0)).toBe(1);
    expect(clampSpans(-3)).toBe(1);
    expect(clampSpans(NaN)).toBe(1);
    expect(clampSpans(Infinity)).toBe(1);
    expect(clampSpans(2.9)).toBe(2);
    expect(clampSpans(1e9)).toBe(64);
  });
});

describe('pxPerCell', () => {
  it('reads the image’s own pixels per cell off the box', () => {
    // 10-cell-wide footprint from a 1000px texture = 100 image px per cell.
    // A box 3 cells wide covering 3 of them reads back exactly 100.
    expect(pxPerCell({ boxSize: 3, footprintWidth: 10, nativePx: 1000, spans: 3 })).toBeCloseTo(
      100,
      9,
    );
    expect(pxPerCell({ boxSize: 1.41, footprintWidth: 10, nativePx: 1000, spans: 3 })).toBeCloseTo(
      47,
      9,
    );
  });

  it('never returns NaN or Infinity — degenerate input reads as null', () => {
    expect(pxPerCell({ boxSize: 0, footprintWidth: 10, nativePx: 1000, spans: 1 })).toBeNull();
    expect(pxPerCell({ boxSize: 1, footprintWidth: 0, nativePx: 1000, spans: 1 })).toBeNull();
    expect(pxPerCell({ boxSize: 1, footprintWidth: 10, nativePx: 0, spans: 1 })).toBeNull();
    expect(pxPerCell({ boxSize: NaN, footprintWidth: 10, nativePx: 1000, spans: 1 })).toBeNull();
    expect(pxPerCell({ boxSize: 1, footprintWidth: 10, nativePx: 1000, spans: 0 })).not.toBeNull();
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

describe('grid calibration session', () => {
  beforeEach(() => {
    endGridCalibration();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addChild(layer().id, image());
  });

  it('refuses to start on an id that is not an asset child', () => {
    expect(startGridCalibration('nope')).toBe(false);
    expect(getGridCalibration()).toBeNull();
  });

  it('starts with the box on the image’s top-left corner', () => {
    expect(startGridCalibration('img')).toBe(true);
    const s = getGridCalibration()!;
    expect(s.box.x).toBeCloseTo(0, 6);
    expect(s.box.y).toBeCloseTo(0, 6);
    expect(s.spans).toBe(3);
    // Visibly on the image and a useful fraction of it: a 10-cell map opens with
    // a 3-cell box, so the readout reads back the grid it was sized against.
    expect(s.box.size).toBeCloseTo(3, 6);
  });

  it('keeps the box inside a small image rather than swallowing it', () => {
    // Footprint 2x2 — half of it, not the 3-cell default that would overhang.
    useStore.getState().updateChild(layer().id, 'img', { width: 4, height: 4 });
    startGridCalibration('img');
    expect(getGridCalibration()!.box.size).toBeCloseTo(1, 6);
  });

  it('clamps a box dragged to nothing and a nonsense span', () => {
    startGridCalibration('img');
    setCalibrationBox({ x: 1, y: 1, size: 0 });
    expect(getGridCalibration()!.box.size).toBe(MIN_BOX_WORLD);
    setCalibrationSpans(-4);
    expect(getGridCalibration()!.spans).toBe(1);
  });

  it('applies scale, offset and the lock as one undoable step', () => {
    startGridCalibration('img');
    setCalibrationBox({ x: 2.3, y: 4.8, size: 1.5 });
    setCalibrationSpans(3);

    expect(applyGridCalibration()).toBe(true);
    expect(getGridCalibration()).toBeNull();

    const after = placed();
    expect(after.width * after.scale).toBeCloseTo(20, 6);
    // No per-child lock exists in this codebase — the image's layer is what locks.
    expect(layer().locked).toBe(true);

    undoManager.undo();
    const back = placed();
    expect(back.width * back.scale).toBeCloseTo(10, 6);
    expect(back.position).toEqual({ x: 5, y: 5 });
    expect(layer().locked).toBe(false);
    expect(undoManager.canRedo()).toBe(true);
  });

  it('refuses an impossible calibration and stays in the mode', () => {
    startGridCalibration('img');
    setCalibrationBox({ x: 0, y: 0, size: MIN_BOX_WORLD });
    setCalibrationSpans(64);

    expect(applyGridCalibration()).toBe(false);
    expect(getGridCalibration()).not.toBeNull();
    expect(layer().locked).toBe(false);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('skipping leaves the image untouched and unlocked', () => {
    startGridCalibration('img');
    setCalibrationBox({ x: 2, y: 2, size: 0.5 });
    endGridCalibration();

    expect(getGridCalibration()).toBeNull();
    expect(placed()).toEqual(image());
    expect(layer().locked).toBe(false);
    expect(undoManager.canUndo()).toBe(false);
  });
});
