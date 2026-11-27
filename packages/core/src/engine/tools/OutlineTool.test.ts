import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { OutlineTool } from './OutlineTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { AddRoomCommand } from '../../store/roomCommands';
import { applyOutlineEdit, beginOutlineDrag, cancelOutlineDrag, endOutlineDrag, resolveOutline, updateOutlineDrag } from '../shapeNodeEdit';
import type { DungeonLayer } from '../../store/types';

// jsdom sends emscripten down the browser path; hand it the bytes directly.
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

function active(): DungeonLayer {
  const s = useStore.getState();
  const l = s.layers.find((x) => x.id === s.ui.activeLayerId);
  if (!l || l.type !== 'dungeon') throw new Error('no active dungeon layer');
  return l;
}

const rooms = () => active().rooms ?? [];
const click = (tool: OutlineTool, x: number, y: number, e?: Partial<PointerEvent>) => {
  tool.onPointerDown({ x, y }, e as PointerEvent);
  tool.onPointerUp({ x, y }, e as PointerEvent);
};
const key = (tool: OutlineTool, k: string) => tool.onKeyDown(new KeyboardEvent('keydown', { key: k }));

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  const first = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
  useStore.getState().setActiveLayerId(first.id);
});

describe('OutlineTool', () => {
  it('drags a rectangle into a numbered room with that outline, one undo step, laying no floor', () => {
    const tool = new OutlineTool();
    tool.onPointerDown({ x: 1, y: 1 });
    tool.onPointerMove({ x: 5, y: 4 });
    expect(tool.getPreview()?.points).toHaveLength(4);
    tool.onPointerUp({ x: 5, y: 4 });
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).toMatchObject({ name: 'Room 1', number: 1, boundary: [[1, 1], [5, 1], [5, 4], [1, 4]] });
    expect(active().children).toHaveLength(0);
    undoManager.undo();
    expect(rooms()).toHaveLength(0);
  });

  it('clicks a polygon, closed by Enter, numbered after the rooms already there', () => {
    undoManager.execute(new AddRoomCommand(active().id, { id: 'a', name: 'Hall', number: 3, anchor: [20, 20] }));
    const tool = new OutlineTool();
    click(tool, 0, 0);
    click(tool, 6, 0);
    click(tool, 3, 5);
    expect(tool.isActive()).toBe(true);
    key(tool, 'Enter');
    expect(tool.isActive()).toBe(false);
    const made = rooms().find((r) => r.id !== 'a')!;
    expect(made).toMatchObject({ name: 'Room 4', number: 4, boundary: [[0, 0], [6, 0], [3, 5]] });
  });

  it('closes on a click on the first corner', () => {
    const tool = new OutlineTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    click(tool, 4, 4);
    click(tool, 0.05, 0.05);
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0].boundary).toHaveLength(3);
  });

  it('cancels on Escape and refuses an outline of two corners', () => {
    const tool = new OutlineTool();
    click(tool, 0, 0);
    click(tool, 4, 0);
    key(tool, 'Enter');
    expect(rooms()).toHaveLength(0);
    key(tool, 'Escape');
    expect(tool.isActive()).toBe(false);
    expect(tool.getPreview()).toBeNull();
  });

  it('keeps a side to 15 degree steps with Shift', () => {
    const tool = new OutlineTool();
    click(tool, 0, 0);
    click(tool, 10, 0.4, { shiftKey: true });
    click(tool, 5, 6);
    key(tool, 'Enter');
    const [, second] = rooms()[0].boundary!;
    expect(second[1]).toBeCloseTo(0, 6);
  });

  it('moves an outlined room’s points with the floor outline handles, one undo step each', () => {
    const tool = new OutlineTool();
    tool.onPointerDown({ x: 1, y: 1 });
    tool.onPointerMove({ x: 5, y: 4 });
    tool.onPointerUp({ x: 5, y: 4 });
    const id = rooms()[0].id;
    useStore.getState().setShapeNodeEdit(id);
    expect(resolveOutline(id)).toMatchObject({ roomId: id, outline: [[1, 1], [5, 1], [5, 4], [1, 4]] });
    // A drag: previews on the room, lands as one step, and no floor appears.
    expect(beginOutlineDrag('vertex', 1)).toBe(true);
    updateOutlineDrag({ x: 7, y: 1 }, { x: 2, y: 0 });
    expect(rooms()[0].boundary![1]).toEqual([7, 1]);
    endOutlineDrag();
    expect(rooms()[0].boundary![1]).toEqual([7, 1]);
    expect(active().children).toHaveLength(0);
    // A point deleted from the card or the key.
    applyOutlineEdit({ kind: 'delete', index: 3 }, 'Delete vertex');
    expect(rooms()[0].boundary).toHaveLength(3);
    undoManager.undo();
    expect(rooms()[0].boundary).toHaveLength(4);
    undoManager.undo();
    expect(rooms()[0].boundary![1]).toEqual([5, 1]);
    // A drag abandoned puts the outline back.
    beginOutlineDrag('vertex', 0);
    updateOutlineDrag({ x: 0, y: 0 }, { x: -1, y: -1 });
    cancelOutlineDrag();
    expect(rooms()[0].boundary![0]).toEqual([1, 1]);
  });

  it('gives the outline to the room Outline it was pressed for, instead of making one', () => {
    undoManager.execute(new AddRoomCommand(active().id, { id: 'lost', name: 'Crypt', number: 1, anchor: [50, 50] }));
    useStore.setState((s) => {
      s.ui.outlineRoomId = 'lost';
    });
    const tool = new OutlineTool();
    tool.onPointerDown({ x: 2, y: 2 });
    tool.onPointerMove({ x: 6, y: 6 });
    tool.onPointerUp({ x: 6, y: 6 });
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).toMatchObject({ id: 'lost', name: 'Crypt', anchor: [4, 4], boundary: [[2, 2], [6, 2], [6, 6], [2, 6]] });
    expect(useStore.getState().ui.outlineRoomId).toBeNull();
    undoManager.undo();
    expect(rooms()[0].boundary).toBeUndefined();
  });
});
