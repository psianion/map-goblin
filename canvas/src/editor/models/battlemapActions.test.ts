import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readPictureFile } = vi.hoisted(() => ({
  readPictureFile: vi.fn(async (_file: File) => ({ assetId: 'night', imageSource: { fileName: 'crypt-night.png', width: 5040, height: 3360 } })),
}));
vi.mock('@/canvas/importImage', () => ({ readPictureFile }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), subtle: vi.fn() } }));

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer, ImageLayer } from '@/store/types';
import { endGridCalibration, getGridCalibration } from '@/canvas/gridCalibration';
import { isBattlemapLayer, sheetSections, showRows } from './layerSheetModel';
import {
  convertToTraceCommand,
  lineUpPicture,
  moveToBattlemapCommand,
  pictureLine,
  replacePicture,
} from './battlemapActions';

/** A 2520 by 1680 px picture lined up 36 by 24 cells, its corner 0.3 and 0.4 off the origin. */
const picture = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'img', name: 'Image 1a2b', childType: 'asset', visible: true, objectType: 'image', assetId: 'day',
  position: { x: 17.7, y: 11.6 }, rotation: 0, scale: 1, width: 36, height: 24, tint: '#ffffff', flipX: false, flipY: false,
  imageSource: { fileName: 'Crypt 36x24.png', width: 2520, height: 1680 },
  ...over,
});

const barrel = (): AssetChild => ({ ...picture(), id: 'barrel', objectType: 'asset', assetId: 'test:barrel', imageSource: undefined, width: 1, height: 1 });

const dungeons = () => useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
const base = () => dungeons()[0];

beforeEach(() => {
  endGridCalibration();
  undoManager.clear();
  useStore.getState().resetToDefault();
});

describe('a Battlemap layer', () => {
  it('is a dungeon layer holding pictures and nothing else', () => {
    useStore.getState().addChild(base().id, picture());
    expect(isBattlemapLayer(base())).toBe(true);
    useStore.getState().addChild(base().id, barrel());
    expect(isBattlemapLayer(base())).toBe(false);
  });

  it('has the battlemap sheet with only the grid to show', () => {
    useStore.getState().addChild(base().id, picture());
    expect(sheetSections(base())).toEqual(['battlemap', 'show', 'actions']);
    expect(showRows(base()).map((r) => r.key)).toEqual(['grid']);
  });

  it('names its picture by pixels and cells', () => {
    expect(pictureLine(picture())).toBe('2520 × 1680 px · 36 × 24 cells');
  });
});

describe('Convert to trace', () => {
  it('makes a trace in the same place, drops the emptied layer, one undo step', () => {
    useStore.getState().addChild(base().id, picture());
    const layerId = base().id;
    const before = useStore.getState().layers.length;
    undoManager.execute(convertToTraceCommand('img')!);

    const trace = useStore.getState().layers.find((l): l is ImageLayer => l.type === 'image')!;
    expect(trace).toMatchObject({ imageKey: 'day', fileName: 'Crypt 36x24.png', fit: 'original' });
    expect(trace.placement!.x).toBeCloseTo(-0.3, 9);
    expect(trace.placement!.y).toBeCloseTo(-0.4, 9);
    expect(trace.placement).toMatchObject({ width: 36, height: 24 });
    expect(useStore.getState().layers.some((l) => l.id === layerId)).toBe(false);

    undoManager.undo();
    expect(useStore.getState().layers).toHaveLength(before);
    expect(useStore.getState().layers.some((l) => l.type === 'image')).toBe(false);
    expect(base().children.find((c) => c.id === 'img')).toEqual(picture());
  });

  it('keeps a layer that holds other things', () => {
    useStore.getState().addChild(base().id, picture());
    useStore.getState().addChild(base().id, barrel());
    undoManager.execute(convertToTraceCommand('img')!);
    expect(base().children.map((c) => c.id)).toEqual(['barrel']);
  });
});

describe('Use as Battlemap', () => {
  it('moves a picture among props onto a locked Battlemap layer at the bottom, its corner on the origin', () => {
    const among = picture({ position: { x: 40, y: 40 }, width: 5, height: 5 * (1680 / 2520) });
    useStore.getState().addChild(base().id, among);
    useStore.getState().addChild(base().id, barrel());
    const move = moveToBattlemapCommand('img')!;
    undoManager.execute(move.command);

    const target = dungeons()[0];
    expect(target).toMatchObject({ name: 'Battlemap', locked: true });
    const moved = target.children[0] as AssetChild;
    // 36 squares across from the name, the height in step.
    expect(moved.width).toBeCloseTo(36, 9);
    expect(moved.height).toBeCloseTo(24, 9);
    expect(moved.position).toEqual({ x: 18, y: 12 });
    expect(dungeons()[1].children.map((c) => c.id)).toEqual(['barrel']);

    undoManager.undo();
    expect(dungeons()).toHaveLength(1);
    expect(base().children.find((c) => c.id === 'img')).toEqual(among);
  });

  it('does nothing for a picture already on one', () => {
    useStore.getState().addChild(base().id, picture());
    expect(moveToBattlemapCommand('img')).toBeNull();
  });
});

describe('Replace', () => {
  it('swaps the picture keeping its corner and width, one undo step', async () => {
    useStore.getState().addChild(base().id, picture());
    await replacePicture('img', new File(['x'], 'crypt-night.png'));
    const after = base().children[0] as AssetChild;
    expect(after.assetId).toBe('night');
    expect(after.imageSource).toEqual({ fileName: 'crypt-night.png', width: 5040, height: 3360 });
    expect(after.width).toBe(36);
    expect(after.height).toBeCloseTo(24, 9);
    expect(after.position.x - 18).toBeCloseTo(-0.3, 9);
    expect(after.position.y - 12).toBeCloseTo(-0.4, 9);
    undoManager.undo();
    expect(base().children[0]).toEqual(picture());
  });
});

describe('Line up grid', () => {
  it('opens the line-up seeded with the squares in the file name', async () => {
    useStore.getState().addChild(base().id, picture());
    expect(await lineUpPicture('img')).toBe(true);
    expect(getGridCalibration()!.lattice).toMatchObject({ cols: 36, rows: 24 });
    expect(getGridCalibration()!.sourcePx).toEqual({ width: 2520, height: 1680 });
  });
});
