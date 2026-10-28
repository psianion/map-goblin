import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import { SelectTool } from './SelectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createSelectionRemovalCommand } from '../../store/commands';
import { setRoomPicking } from '../hitTest';
import { getAnchorPreview, onAnchorPreview, type AnchorPreview } from '../roomAnchorDrag';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer, Room } from '../../store/types';

/*
 * Rooms in the Select tool: a click selects one (rooms pick where a host turned it on),
 * a press never drags it like a prop, and its badge drags the anchor — previewed on the
 * overlay only, one SetRoomAnchorCommand on release.
 */

const ZOOM = 20;

function makeEngine(): RenderEngine {
  const overlay = new Container();
  const rect = { left: 0, top: 0 } as DOMRect;
  return {
    overlay: () => overlay,
    canvas: () => ({ getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement,
    stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
    worldToScreen: (wx: number, wy: number) => ({ x: wx * ZOOM, y: wy * ZOOM }),
    screenToWorld: (sx: number, sy: number) => ({ x: sx / ZOOM, y: sy / ZOOM }),
  } as unknown as RenderEngine;
}

/** A pointer event at a world point (the engine maps world × ZOOM to screen). */
const at = (x: number, y: number): PointerEvent =>
  ({ clientX: x * ZOOM, clientY: y * ZOOM, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }) as PointerEvent;

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

const hall: Room = {
  id: 'hall',
  name: 'Hall',
  number: 1,
  anchor: [5, 5],
  face: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
};

let tool: SelectTool;
let previews: (AnchorPreview | null)[] = [];
let unsub: () => void = () => {};

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  useStore.getState().setRooms(layer().id, [hall]);
  setRoomPicking(true);
  tool = new SelectTool(makeEngine());
  previews = [];
  unsub = onAnchorPreview((p) => previews.push(p));
});

afterEach(() => {
  unsub();
  setRoomPicking(false);
});

describe('SelectTool — rooms', () => {
  it('a click in a room selects it, and the press does not start a move', () => {
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    expect(useStore.getState().selection.selectedIds).toEqual(['hall']);
    expect(tool.isGizmoDragging()).toBe(false);
    tool.onPointerUp({ x: 2, y: 2 }, at(2, 2));
    expect(undoManager.canUndo()).toBe(false);
  });

  it("dragging a selected room's badge previews on the overlay and moves the anchor once, on release", () => {
    useStore.getState().setSelectedIds(['hall']);
    tool.onPointerDown({ x: 5, y: 5 }, at(5, 5));
    tool.onPointerMove({ x: 6, y: 5 }, at(6, 5));
    tool.onPointerMove({ x: 7, y: 6 }, at(7, 6));
    // Nothing written per move: the store still has the old anchor.
    expect(layer().rooms![0].anchor).toEqual([5, 5]);
    expect(getAnchorPreview()).toEqual({ layerId: layer().id, roomId: 'hall', point: [7, 6] });

    tool.onPointerUp({ x: 7, y: 6 }, at(7, 6));
    expect(layer().rooms![0].anchor).toEqual([7, 6]);
    expect(getAnchorPreview()).toBeNull();
    expect(previews.at(-1)).toBeNull();

    undoManager.undo();
    expect(layer().rooms![0].anchor).toEqual([5, 5]);
  });

  it('the badge sits inside the face, not on the anchor: it is pressed there, and a press in place moves nothing', () => {
    // A split half: its anchor right by the divider, its badge in the middle of its face.
    useStore.getState().setRooms(layer().id, [{ ...hall, anchor: [9.5, 5] }]);
    useStore.getState().setSelectedIds(['hall']);
    // A press and release on the badge without travel is a click: the anchor stays.
    tool.onPointerDown({ x: 5, y: 5 }, at(5, 5));
    tool.onPointerUp({ x: 5, y: 5 }, at(5, 5));
    expect(layer().rooms![0].anchor).toEqual([9.5, 5]);
    expect(undoManager.canUndo()).toBe(false);
    // Dragged from where it is drawn, the anchor lands where the badge is let go.
    tool.onPointerDown({ x: 5, y: 5 }, at(5, 5));
    tool.onPointerMove({ x: 4, y: 3 }, at(4, 3));
    tool.onPointerUp({ x: 4, y: 3 }, at(4, 3));
    expect(layer().rooms![0].anchor).toEqual([4, 3]);
  });

  it('Escape abandons a badge drag without an undo step', () => {
    useStore.getState().setSelectedIds(['hall']);
    tool.onPointerDown({ x: 5, y: 5 }, at(5, 5));
    tool.onPointerMove({ x: 8, y: 8 }, at(8, 8));
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(getAnchorPreview()).toBeNull();
    expect(layer().rooms![0].anchor).toEqual([5, 5]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('the badge of a room that is not selected does not drag: the press selects it', () => {
    tool.onPointerDown({ x: 5, y: 5 }, at(5, 5));
    tool.onPointerMove({ x: 8, y: 8 }, at(8, 8));
    tool.onPointerUp({ x: 8, y: 8 }, at(8, 8));
    expect(useStore.getState().selection.selectedIds).toEqual(['hall']);
    expect(layer().rooms![0].anchor).toEqual([5, 5]);
  });

  it('hovering a room sets the hovered id (the overlay draws its outline)', () => {
    tool.onPointerMove({ x: 3, y: 3 }, at(3, 3));
    expect(useStore.getState().selection.hoveredId).toBe('hall');
  });
});

describe('deleting a selected room', () => {
  it('the selection removal takes the room (the floor stays), one undo step', () => {
    const removal = createSelectionRemovalCommand(['hall']);
    expect(removal.rooms).toBe(1);
    undoManager.execute(removal.command!);
    expect(layer().rooms ?? []).toHaveLength(0);
    undoManager.undo();
    expect(layer().rooms!.map((r) => r.id)).toEqual(['hall']);
  });
});
