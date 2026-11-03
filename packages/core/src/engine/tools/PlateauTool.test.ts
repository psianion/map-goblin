import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PlateauTool } from './PlateauTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { keepPlateausOnGround } from '../plateauGround';
import { UpdateChildCommand } from '../../store/commands';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../../store/types';

const warning = vi.fn();

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
  setNotify({ success() {}, error() {}, warning, info() {} } as unknown as Parameters<typeof setNotify>[0]);
}, 30_000);

const ev = (sx: number, sy: number, extra: Partial<PointerEvent> = {}): PointerEvent =>
  ({ clientX: sx, clientY: sy, buttons: 0, shiftKey: false, altKey: false, ...extra }) as PointerEvent;

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const plateaus = () => layer().children.filter((c): c is PlateauChild => c.childType === 'plateau');
const settle = () => new Promise((r) => setTimeout(r, 0));

function floor(): ShapeChild {
  return {
    id: 'field', name: 'Field', childType: 'shape', visible: true, shapeType: 'rectangle',
    contours: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  };
}

/** A press at `from`, dragged through `through` (20 px a cell), released at the last. */
function drag(tool: PlateauTool, through: [number, number][]): void {
  const [x0, y0] = through[0];
  tool.onPointerDown({ x: x0, y: y0 }, ev(x0 * 20, y0 * 20, { buttons: 1 }));
  for (const [x, y] of through.slice(1)) tool.onPointerMove({ x, y }, ev(x * 20, y * 20, { buttons: 1 }));
  const [x, y] = through[through.length - 1];
  tool.onPointerUp({ x, y });
}

/** Points every 0.25 cells round a box, back to the start. */
function aroundBox(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  for (let k = 0; k < 4; k++) {
    const [a, b] = [corners[k], corners[k + 1]];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
    for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  }
  out.push([x0, y0]);
  return out;
}

describe('PlateauTool', () => {
  let tool: PlateauTool;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    warning.mockClear();
    useStore.getState().addChild(layer().id, floor());
    useStore.setState((s) => {
      s.grid.snapEnabled = false;
    });
    tool = new PlateauTool();
  });

  it('draws a dragged rectangle on the field as one plateau at +1 with a cliff, selected, one undo step', async () => {
    drag(tool, aroundBox(4, 4, 10, 8));
    await settle();
    expect(plateaus()).toHaveLength(1);
    const [p] = plateaus();
    expect(p).toMatchObject({ height: 1, edge: 'cliff', name: 'Plateau 1' });
    // Simplified to its corners, give or take.
    expect(p.contours[0].length).toBeLessThanOrEqual(6);
    expect(useStore.getState().selection.selectedIds).toEqual([p.id]);
    undoManager.undo();
    expect(plateaus()).toHaveLength(0);
  });

  it('places clicked points and closes on the first, with the dock height and edge', async () => {
    useStore.getState().updateToolSettings({ plateau: { height: -2, edge: 'slope' } });
    for (const [x, y] of [[2, 2], [8, 2], [8, 6], [2, 6], [2.1, 2.1]] as const) {
      tool.onPointerDown({ x, y }, ev(x * 20, y * 20, { buttons: 1 }));
      tool.onPointerUp({ x, y });
      await new Promise((r) => setTimeout(r, 310));
    }
    await settle();
    expect(plateaus()).toHaveLength(1);
    expect(plateaus()[0].contours[0]).toEqual([[2, 2], [8, 2], [8, 6], [2, 6]]);
    expect(plateaus()[0]).toMatchObject({ height: -2, edge: 'slope' });
  });

  it('holds a click to 15° steps with Shift, finishes on Enter and drops on Escape', async () => {
    tool.onPointerDown({ x: 2, y: 2 }, ev(40, 40));
    tool.onPointerUp({ x: 2, y: 2 });
    tool.onPointerDown({ x: 8, y: 2.4 }, ev(160, 48, { shiftKey: true }));
    tool.onPointerUp({ x: 8, y: 2.4 });
    tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
    expect(tool.isActive()).toBe(false);
    for (const [x, y] of [[2, 2], [8, 2.3], [8, 6]] as const) {
      tool.onPointerDown({ x, y }, ev(x * 20, y * 20, { shiftKey: x === 8 && y === 2.3 }));
      tool.onPointerUp({ x, y });
    }
    tool.onKeyDown({ key: 'Enter' } as KeyboardEvent);
    await settle();
    expect(plateaus()).toHaveLength(1);
    // Shift laid the second point level with the first.
    expect(plateaus()[0].contours[0][1][1]).toBeCloseTo(2, 6);
  });

  it('refuses a plateau drawn on void, with the toast, and adds nothing', async () => {
    drag(tool, aroundBox(30, 30, 36, 34));
    await settle();
    expect(plateaus()).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('A plateau needs ground under it');
    expect(undoManager.canUndo()).toBe(false);
    // Half on the field is still refused.
    drag(tool, aroundBox(16, 4, 24, 8));
    await settle();
    expect(plateaus()).toHaveLength(0);
  });

  it('refuses a ring under a cell', async () => {
    drag(tool, aroundBox(4, 4, 4.8, 4.8));
    await settle();
    expect(plateaus()).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('A plateau needs at least one cell');
  });

  it('takes back a move that leaves the ground, leaving nothing to redo', async () => {
    drag(tool, aroundBox(4, 4, 10, 8));
    await settle();
    const [p] = plateaus();
    const off = p.contours[0].map(([x, y]): [number, number] => [x + 40, y]);
    const cmd = new UpdateChildCommand('Move', layer().id, p.id, { contours: p.contours }, { contours: [off] });
    undoManager.execute(cmd);
    expect(await keepPlateausOnGround(cmd, [p.id])).toBe(false);
    expect(plateaus()[0].contours).toEqual(p.contours);
    expect(undoManager.canRedo()).toBe(false);
    const ok = new UpdateChildCommand('Move', layer().id, p.id, { contours: p.contours }, { contours: [p.contours[0].map(([x, y]): [number, number] => [x + 2, y])] });
    undoManager.execute(ok);
    expect(await keepPlateausOnGround(ok, [p.id])).toBe(true);
  });
});
