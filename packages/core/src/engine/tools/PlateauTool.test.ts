import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PlateauTool } from './PlateauTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { keepPlateausOnGround, plateauGround } from '../plateauGround';
import { UpdateChildCommand } from '../../store/commands';
import type { DungeonLayer, PlateauChild, PlateauToolSettings, ShapeChild } from '../../store/types';

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

/** Every 0.25 cells along a polyline, the brush's samples. */
function along(...pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
    for (let i = 1; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  }
  return out;
}

/** A plateau's outline area less its holes. */
const plateauArea = (p: PlateauChild) =>
  p.contours.reduce((sum, r, i) => {
    let a = 0;
    for (let k = 0; k < r.length; k++) a += r[k][0] * r[(k + 1) % r.length][1] - r[(k + 1) % r.length][0] * r[k][1];
    return sum + (i === 0 ? 1 : -1) * Math.abs(a / 2);
  }, 0);

describe('the Elevation brush', () => {
  let tool: PlateauTool;
  const set = (patch: Partial<PlateauToolSettings>) =>
    useStore.getState().updateToolSettings({ plateau: { height: 1, edge: 'cliff', input: 'brush', brushRadius: 1, ...patch } });
  const paint = async (pts: [number, number][]) => {
    drag(tool, pts);
    await settle();
  };

  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    warning.mockClear();
    useStore.getState().addChild(layer().id, floor());
    useStore.setState((s) => {
      s.grid.snapEnabled = false;
    });
    set({});
    tool = new PlateauTool();
  });

  it('paints a stroke as one closed plateau of tens of nodes, one undo step', async () => {
    await paint(along([4, 10], [12, 10]));
    expect(plateaus()).toHaveLength(1);
    const [p] = plateaus();
    expect(p.contours).toHaveLength(1);
    expect(p.contours[0].length).toBeGreaterThanOrEqual(8);
    expect(p.contours[0].length).toBeLessThanOrEqual(60);
    // An 8-cell stroke two cells wide with round ends.
    expect(plateauArea(p)).toBeCloseTo(16 + Math.PI, 0);
    expect(p).toMatchObject({ height: 1, edge: 'cliff' });
    expect(useStore.getState().selection.selectedIds).toEqual([p.id]);
    undoManager.undo();
    expect(plateaus()).toHaveLength(0);
  });

  it('a click is one dab', async () => {
    await paint([[10, 10]]);
    expect(plateaus()).toHaveLength(1);
    expect(plateauArea(plateaus()[0])).toBeCloseTo(Math.PI, 0);
  });

  it('grows the plateaus a stroke of the same settings overlaps into the earliest, as one undo step', async () => {
    await paint(along([3, 10], [7, 10]));
    await paint(along([13, 10], [17, 10]));
    expect(plateaus()).toHaveLength(2);
    const [first, second] = plateaus();
    await paint(along([6, 10], [14, 10]));
    expect(plateaus()).toHaveLength(1);
    expect(plateaus()[0].id).toBe(first.id);
    expect(plateauArea(plateaus()[0])).toBeCloseTo(28 + Math.PI, 0);
    expect(plateaus()[0].tangents).toBeUndefined();
    undoManager.undo();
    expect(plateaus().map((p) => p.id)).toEqual([first.id, second.id]);
    expect(plateaus()[0].contours).toEqual(first.contours);
    expect(plateaus()[1].contours).toEqual(second.contours);
  });

  it('makes a second plateau where the height or the face differs', async () => {
    await paint(along([4, 10], [8, 10]));
    set({ height: 2 });
    await paint(along([7, 10], [11, 10]));
    expect(plateaus()).toHaveLength(2);
    set({ edge: 'slope', faceArt: 'gg-forge:face_stone_4x4_floor_A' });
    await paint(along([4, 15], [8, 15]));
    set({ edge: 'slope', faceArt: 'gg-forge:face_dirt_4x4_floor_A' });
    await paint(along([7, 15], [11, 15]));
    expect(plateaus()).toHaveLength(4);
    // The same face again grows its own.
    await paint(along([10, 15], [13, 15]));
    expect(plateaus()).toHaveLength(4);
  });

  it('leaves no sliver of a hole where a second stroke crosses the first', async () => {
    set({ brushRadius: 1.5 });
    const wave = Array.from({ length: 23 }, (_, i): [number, number] => [3 + i * 0.5, 7.5 + Math.sin(i / 3) * 1.2]);
    const across = Array.from({ length: 9 }, (_, i): [number, number] => [9 + i * 0.4, 9 + i * 0.5]);
    await paint(along(...wave));
    await paint(along(...across));
    expect(plateaus()).toHaveLength(1);
    expect(plateaus()[0].contours).toHaveLength(1);
  });

  it('keeps the hole of a stroke that comes round on itself', async () => {
    await paint(along([4, 4], [14, 4], [14, 14], [4, 14], [4, 4]));
    expect(plateaus()).toHaveLength(1);
    expect(plateaus()[0].contours).toHaveLength(2);
  });
});

describe('Curve', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    warning.mockClear();
    useStore.setState((s) => {
      s.grid.snapEnabled = false;
    });
    useStore.getState().setCurveMode(true);
  });

  const click = async (tool: PlateauTool, pts: [number, number][]) => {
    for (const [x, y] of pts) {
      tool.onPointerDown({ x, y }, ev(x * 20, y * 20));
      tool.onPointerUp({ x, y });
    }
    tool.onKeyDown({ key: 'Enter' } as KeyboardEvent);
    await settle();
  };

  it('stores clicked points smoothed through, nodes as clicked', async () => {
    useStore.getState().addChild(layer().id, floor());
    const tool = new PlateauTool();
    await click(tool, [[2, 2], [8, 2], [8, 6], [2, 6]]);
    expect(plateaus()).toHaveLength(1);
    const [p] = plateaus();
    expect(p.contours).toEqual([[[2, 2], [8, 2], [8, 6], [2, 6]]]);
    expect(p.tangents).toHaveLength(1);
    expect(p.tangents![0].every(Boolean)).toBe(true);
    // The preview showed the curve: more points than were clicked.
    for (const [x, y] of [[2, 2], [8, 2], [8, 6]] as const) {
      tool.onPointerDown({ x, y }, ev(x * 20, y * 20));
      tool.onPointerUp({ x, y });
    }
    expect(tool.getPreview()!.points.length).toBeGreaterThan(4);
  });

  it('stores a ring the frame cuts as cut, without handles', async () => {
    useStore.setState((s) => {
      s.mapSettings.fixedSize = { width: 30, height: 30, locked: true };
      s.mapSettings.ground = { color: '#6b7a4f' };
    });
    await click(new PlateauTool(), [[-3, 25], [8, 25], [8, 33], [-3, 33]]);
    expect(warning).not.toHaveBeenCalled();
    expect(plateaus()).toHaveLength(1);
    const [p] = plateaus();
    expect(p.tangents).toBeUndefined();
    for (const [x, y] of p.contours[0]) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(30 + 1e-6);
    }
  });
});

describe('a plateau at the edge of a sized map', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    warning.mockClear();
    useStore.setState((s) => {
      s.grid.snapEnabled = false;
      s.mapSettings.fixedSize = { width: 30, height: 30, locked: true };
      s.mapSettings.ground = { color: '#6b7a4f' };
    });
  });

  it('is drawn across the edge as one plateau of what lies inside the frame', async () => {
    drag(new PlateauTool(), aroundBox(-3, 25, 8, 33));
    await settle();
    expect(warning).not.toHaveBeenCalled();
    expect(plateaus()).toHaveLength(1);
    const [p] = plateaus();
    for (const [x, y] of p.contours[0]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(30);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(30);
    }
    expect(useStore.getState().selection.selectedIds).toEqual([p.id]);
  });

  it('is judged by the part inside the frame', async () => {
    expect(await plateauGround(layer(), [[-5, 10], [5, 10], [5, 14], [-5, 14]])).toBe('ok');
    expect(await plateauGround(layer(), [[-9, 10], [-5, 10], [-5, 14], [-9, 14]])).toBe('small');
  });
});
