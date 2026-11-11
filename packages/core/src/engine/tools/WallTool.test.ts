import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WallTool, freehandChain } from './WallTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { createDungeonLayer } from '../../store/factories';
import type { DungeonLayer } from '../../store/types';

function layerById(id: string): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.id === id);
  if (!l || l.type !== 'dungeon') throw new Error(`no dungeon layer ${id}`);
  return l;
}

describe('WallTool — chain-finalize layer validation (F1)', () => {
  let tool: WallTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new WallTool();
  });

  it('commits the chain to the layer active when it was drawn', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('writes no width, so the wall follows the layer Width afterwards', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);
    useStore.getState().updateToolSettings({ wallType: 'window' });

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    const [wall] = layerById(a.id).standaloneWalls;
    expect(wall).not.toHaveProperty('width');
    expect(wall.wallType).toBe('window');
  });

  it('refuses to commit and warns when the drawing layer is locked before Enter', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    // Locked mid-chain — a real DM locking the layer while a chain is live.
    useStore.getState().updateLayer(a.id, { locked: true });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('refuses to commit and warns when the drawing layer is hidden before Enter', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().updateLayer(a.id, { visible: false });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });

  it('warns "Layer was removed" when the drawing layer is deleted before Enter', () => {
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(b.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().removeLayer(b.id);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(warning).toHaveBeenCalledWith('Layer was removed');
  });

  it('commits to the layer the chain started on, not one switched to mid-chain', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    // Switching to an unlocked, visible layer mid-chain — the pointerDown
    // guard on B would happily pass if this ever went through it again.
    useStore.getState().setActiveLayerId(b.id);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(1);
    expect(layerById(b.id).standaloneWalls).toHaveLength(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it('double-click commit inherits the same captured-layer validation', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().updateLayer(a.id, { locked: true });
    // Double-click at the same spot finalizes via the same finalize() path.
    tool.onPointerDown({ x: 5, y: 0 });

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});

// The dimension readout measures `getPreview()` and goes away when it returns null,
// so a cancelled chain has to leave no preview behind, not even its first click.
describe('WallTool — Escape leaves nothing to measure', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  it('drops the preview a single click started', () => {
    const tool = new WallTool();
    tool.onPointerDown({ x: 2, y: 3 });
    expect(tool.getPreview()?.points).toHaveLength(2);

    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(tool.getPreview()).toBeNull();
    expect(tool.isActive()).toBe(false);
  });

  it('drops it on cancel() too, the path a tool switch takes', () => {
    const tool = new WallTool();
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerMove({ x: 4, y: 0 });

    tool.cancel();

    expect(tool.getPreview()).toBeNull();
  });
});

describe('freehandChain', () => {
  const line = (n: number, f: (i: number) => { x: number; y: number }) => Array.from({ length: n + 1 }, (_, i) => f(i));
  /** A circle of radius r round (5, 5), `turn` of the way round. */
  const arc = (r: number, turn: number) => line(120, (i) => ({ x: 5 + r * Math.cos((i / 120) * turn * 2 * Math.PI), y: 5 + r * Math.sin((i / 120) * turn * 2 * Math.PI) }));

  it('drops a stroke shorter than half a cell', () => {
    expect(freehandChain(line(4, (i) => ({ x: i * 0.1, y: 0 })))).toBeNull();
  });

  it('simplifies a straight stroke to its two ends', () => {
    expect(freehandChain(line(40, (i) => ({ x: i * 0.1, y: (i % 2) * 0.05 })))).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('closes a long stroke that ends near its start on the start point', () => {
    const chain = freehandChain(arc(3, 0.97))!;
    expect(chain.length).toBeGreaterThanOrEqual(4);
    expect(chain[chain.length - 1]).toEqual(chain[0]);
  });

  it('leaves a stroke open when it ends far from the start, or is too short to be a loop', () => {
    const open = freehandChain(arc(3, 0.6))!;
    expect(open[open.length - 1]).not.toEqual(open[0]);
    const small = freehandChain(arc(0.4, 0.95))!;
    expect(small[small.length - 1]).not.toEqual(small[0]);
  });
});

describe('WallTool — freehand', () => {
  /** An engine whose world point is the client point over ten, unsnapped. */
  const engine = {
    canvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) as unknown as HTMLCanvasElement,
    screenToWorld: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
  };
  const at = (x: number, y: number) => ({ clientX: x * 10, clientY: y * 10, button: 0 }) as PointerEvent;
  let a: DungeonLayer;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
    useStore.getState().updateToolSettings({ wallDraw: 'freehand' });
    a = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);
  });

  it('drags out one wall from the raw points, in one undo step', () => {
    const tool = new WallTool(engine);
    tool.onPointerDown({ x: 0, y: 0 }, at(0, 0));
    // The snapped point the input hands in is ignored mid-stroke; the raw point is kept.
    for (let i = 1; i <= 20; i++) tool.onPointerMove({ x: Math.round(i * 0.2), y: 0 }, at(i * 0.2, i < 10 ? i * 0.2 : (20 - i) * 0.2));
    expect(tool.isActive()).toBe(true);
    expect(tool.getPreview()?.points.length).toBeGreaterThan(10);
    tool.onPointerUp({ x: 4, y: 0 });
    const walls = layerById(a.id).standaloneWalls;
    expect(walls).toHaveLength(1);
    expect(walls[0].points).toEqual([
      [0, 0],
      [expect.closeTo(2, 5), expect.closeTo(2, 5)],
      [4, 0],
    ]);
    expect(tool.isActive()).toBe(false);
    undoManager.undo();
    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
  });

  it('draws nothing for a slip shorter than half a cell', () => {
    const tool = new WallTool(engine);
    tool.onPointerDown({ x: 0, y: 0 }, at(0, 0));
    tool.onPointerMove({ x: 0, y: 0 }, at(0.2, 0));
    tool.onPointerUp({ x: 0.3, y: 0 });
    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
  });

  it('Escape cancels the stroke', () => {
    const tool = new WallTool(engine);
    tool.onPointerDown({ x: 0, y: 0 }, at(0, 0));
    tool.onPointerMove({ x: 3, y: 0 }, at(3, 0));
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tool.isActive()).toBe(false);
    expect(tool.getPreview()).toBeNull();
    tool.onPointerUp({ x: 3, y: 0 });
    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
  });

  it('keeps its ends off the grid, unless the end sits on a drawn wall', () => {
    const tool = new WallTool(engine);
    // The grid would put both ends on whole cells; the pointer is a third of a cell off.
    tool.onPointerDown({ x: 0, y: 0 }, at(0.3, 0.3));
    for (let i = 1; i <= 10; i++) tool.onPointerMove({ x: 0, y: 0 }, at(0.3 + i * 0.3, 0.3));
    tool.onPointerUp({ x: 3, y: 0 }, at(3.3, 0.3));
    const [first] = layerById(a.id).standaloneWalls;
    expect(first.points[0]).toEqual([expect.closeTo(0.3, 5), expect.closeTo(0.3, 5)]);
    expect(first.points[first.points.length - 1]).toEqual([expect.closeTo(3.3, 5), expect.closeTo(0.3, 5)]);

    // A second stroke started on the first wall's end takes the snapped point and joins it.
    const end = first.points[first.points.length - 1];
    tool.onPointerDown({ x: end[0], y: end[1] }, at(3.4, 0.4));
    for (let i = 1; i <= 10; i++) tool.onPointerMove({ x: 0, y: 0 }, at(3.3, 0.3 + i * 0.3));
    tool.onPointerUp({ x: 3, y: 3 }, at(3.3, 3.3));
    expect(layerById(a.id).standaloneWalls).toHaveLength(1);
  });

  it('a loop ending at its start closes into a ring', () => {
    const tool = new WallTool(engine);
    tool.onPointerDown({ x: 0, y: 0 }, at(0, 0));
    for (const [x, y] of [[4, 0], [4, 4], [0, 4], [0, 0.3]]) {
      for (let i = 1; i <= 10; i++) tool.onPointerMove({ x, y }, at(x, y));
    }
    tool.onPointerUp({ x: 0.2, y: 0.2 });
    const [wall] = layerById(a.id).standaloneWalls;
    expect(wall.points[0]).toEqual(wall.points[wall.points.length - 1]);
    expect(wall.points.length).toBeGreaterThanOrEqual(5);
  });
});
