import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PathTool, LAKE_MATERIAL_ID, pathChainLive } from './PathTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer } from '../../store/types';
import type { PathChild } from '../../shared/types';

/** A pointer event at screen (sx, sy) — the tool reads screen px only for the freehand threshold. */
function ev(sx = 0, sy = 0, extra: Partial<PointerEvent> = {}): PointerEvent {
  return { clientX: sx, clientY: sy, buttons: 0, shiftKey: false, altKey: false, ...extra } as PointerEvent;
}
const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, shiftKey: false, ...extra }) as KeyboardEvent;
const wheel = (deltaY: number, shiftKey = false) => ({ deltaY, deltaX: 0, shiftKey }) as WheelEvent;

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const paths = () => layer().children.filter((c): c is PathChild => c.childType === 'path');

/** Click (down + up, no travel) at world (x, y), spaced in time so no two make a double-click. */
function click(tool: PathTool, x: number, y: number, extra: Partial<PointerEvent> = {}) {
  vi.advanceTimersByTime(1000);
  tool.onPointerDown({ x, y }, ev(x * 50, y * 50, extra));
  tool.onPointerUp({ x, y });
}

beforeEach(() => {
  vi.useFakeTimers();
  useStore.getState().resetToDefault();
  undoManager.clear();
  useStore.setState((s) => {
    s.grid.snapEnabled = false;
  });
});

describe('PathTool: clicks', () => {
  it('places a point per click and Enter draws one path, one undo entry', () => {
    const tool = new PathTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 8, 2);
    expect(pathChainLive()).toBe(true);
    tool.onKeyDown(key('Enter'));
    expect(pathChainLive()).toBe(false);
    expect(paths()).toHaveLength(1);
    const p = paths()[0];
    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 2 }]);
    expect(p).toMatchObject({ closed: false, width: 1.5, materialId: 'gg-forge:road-dirt', sort: 'under', name: 'Path 1' });
    expect(p.offset).toBeGreaterThanOrEqual(0);
    expect(p.offset).toBeLessThanOrEqual(4);
    undoManager.undo();
    expect(paths()).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a double-click, or a right-click, finishes too; one point is no path', () => {
    const tool = new PathTool();
    click(tool, 0, 0);
    click(tool, 3, 0);
    tool.onPointerDown({ x: 3.1, y: 0 }, ev()); // second press of a double-click
    expect(paths()).toHaveLength(1);
    expect(paths()[0].points).toHaveLength(2);

    click(tool, 0, 5);
    click(tool, 2, 5);
    expect(tool.onContextMenu()).toBe(true);
    expect(paths()).toHaveLength(2);

    click(tool, 9, 9);
    tool.onKeyDown(key('Enter'));
    expect(paths()).toHaveLength(2);
    expect(tool.onContextMenu()).toBe(false);
  });

  it('Backspace takes the last point back, Escape drops the chain', () => {
    const tool = new PathTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 9, 9);
    tool.onKeyDown(key('Backspace'));
    tool.onKeyDown(key('Enter'));
    expect(paths()[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);

    click(tool, 0, 5);
    click(tool, 4, 5);
    tool.onKeyDown(key('Escape'));
    expect(tool.isActive()).toBe(false);
    expect(paths()).toHaveLength(1);
  });

  it('landing on the first point closes the path', () => {
    const tool = new PathTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 4, 4);
    click(tool, 0.1, 0.1);
    expect(paths()).toHaveLength(1);
    expect(paths()[0].closed).toBe(true);
    expect(paths()[0].points).toHaveLength(3);
  });

  it('the wheel and [ ] set the width of the point about to be placed', () => {
    const tool = new PathTool();
    expect(tool.onWheel(wheel(-100))).toBe(false); // idle: the view keeps the wheel
    click(tool, 0, 0);
    expect(tool.onWheel(wheel(-100))).toBe(true);
    expect(tool.onWheel(wheel(-100))).toBe(true);
    expect(tool.width).toBe(2);
    click(tool, 4, 0);
    tool.onWheel(wheel(100, true));
    expect(tool.width).toBe(1.95);
    tool.onKeyDown(key(']'));
    expect(tool.width).toBe(2.2);
    click(tool, 8, 0);
    tool.onKeyDown(key('Enter'));
    // The first point carries the default width, so it stores none.
    expect(paths()[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0, width: 2 }, { x: 8, y: 0, width: 2.2 }]);
  });

  it('Alt makes the segment into the new point straight; Shift holds it to 15° steps', () => {
    const tool = new PathTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 6, 3, { altKey: true });
    click(tool, 10, 3.4, { shiftKey: true });
    tool.onKeyDown(key('Enter'));
    const pts = paths()[0].points;
    expect(pts[1].handles).toBeNull();
    expect(pts[2].handles).toBeNull();
    expect(pts[0].handles).toBeUndefined();
    expect(pts[3].y).toBeCloseTo(3, 9); // 4.02 cells at ~5.7° snaps flat
  });

  it('snaps to the grid when grid snap is on, and onto another path’s end before that', () => {
    useStore.setState((s) => {
      s.grid.snapEnabled = true;
      s.grid.snapDivision = 2;
    });
    const tool = new PathTool();
    click(tool, 0.2, 0.3);
    click(tool, 3.1, 0.1);
    tool.onKeyDown(key('Enter'));
    expect(paths()[0].points).toEqual([{ x: 0, y: 0.5 }, { x: 3, y: 0 }]);
    click(tool, 3.2, 0.2);
    click(tool, 6, 0);
    tool.onKeyDown(key('Enter'));
    expect(paths()[1].points[0]).toEqual({ x: 3, y: 0 });
  });
});

describe('PathTool: freehand', () => {
  it('a dragged press samples the stroke and simplifies it into points', () => {
    const tool = new PathTool();
    tool.onPointerDown({ x: 0, y: 0 }, ev(0, 0));
    // A straight drag, then a turn: the straight run collapses, the corner stays.
    for (let i = 1; i <= 20; i++) tool.onPointerMove({ x: i * 0.25, y: 0 }, ev(i * 12, 0, { buttons: 1 }));
    for (let i = 1; i <= 20; i++) tool.onPointerMove({ x: 5, y: i * 0.25 }, ev(240, i * 12, { buttons: 1 }));
    tool.onPointerUp({ x: 5, y: 5 });
    tool.onKeyDown(key('Enter'));
    const pts = paths()[0].points;
    expect(pts.length).toBeLessThanOrEqual(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 5, y: 5 });
    expect(pts.some((p) => Math.hypot(p.x - 5, p.y) < 0.35)).toBe(true);
  });

  it('a press that travels under four pixels is a click', () => {
    const tool = new PathTool();
    tool.onPointerDown({ x: 0, y: 0 }, ev(0, 0));
    tool.onPointerMove({ x: 0.05, y: 0 }, ev(3, 0, { buttons: 1 }));
    tool.onPointerUp({ x: 0.05, y: 0 });
    click(tool, 4, 0);
    tool.onKeyDown(key('Enter'));
    expect(paths()[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  });
});

describe('PathTool: lake preset', () => {
  it('draws a closed, filled water path, and needs three points', () => {
    const tool = new PathTool('lake');
    click(tool, 0, 0);
    click(tool, 4, 0);
    tool.onKeyDown(key('Enter'));
    expect(paths()).toHaveLength(0);
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 2, 3);
    tool.onKeyDown(key('Enter'));
    expect(paths()[0]).toMatchObject({ closed: true, fill: true, materialId: LAKE_MATERIAL_ID, name: 'Lake 1' });
  });

  it('previews a closed band', () => {
    const tool = new PathTool('lake');
    click(tool, 0, 0);
    click(tool, 4, 0);
    tool.onPointerMove({ x: 2, y: 3 }, ev());
    const preview = tool.getPreview();
    expect(preview?.type).toBe('polygon');
    expect(preview!.points.length).toBeGreaterThan(6);
  });
});
