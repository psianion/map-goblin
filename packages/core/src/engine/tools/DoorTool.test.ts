import { describe, it, expect, beforeEach } from 'vitest';
import { DoorTool } from './DoorTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createWallRemovalCommand } from '../../store/commands';
import type { DoorChild, WallSegment } from '../../shared/types';
import type { DungeonLayer } from '../../store/types';

const WALL: WallSegment = {
  id: 'w1',
  points: [[0, 5], [10, 5]],
  wallType: 'normal',
  direction: 'both',
  color: '#333333',
  width: 0.4,
  roughness: 0,
};

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function doors(): DoorChild[] {
  return layer().children.filter((c): c is DoorChild => c.childType === 'door');
}

/** The app always moves before it clicks; the tool relies on that ordering. */
function click(tool: DoorTool, x: number, y: number): void {
  tool.onPointerMove({ x, y });
  tool.onPointerDown({ x, y });
  tool.onPointerUp({ x, y });
}

/** Two clicks inside the shared double-click window — what cycles a door's state. */
function doubleClick(tool: DoorTool, x: number, y: number): void {
  click(tool, x, y);
  click(tool, x, y);
}

/** Press, move in steps past the drag slop, release. */
function drag(tool: DoorTool, from: [number, number], to: [number, number]): void {
  tool.onPointerMove({ x: from[0], y: from[1] });
  tool.onPointerDown({ x: from[0], y: from[1] });
  tool.onPointerMove({ x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 });
  tool.onPointerMove({ x: to[0], y: to[1] });
  tool.onPointerUp({ x: to[0], y: to[1] });
}

function selectedIds(): string[] {
  return useStore.getState().selection.selectedIds;
}

describe('DoorTool', () => {
  let tool: DoorTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addWall(layer().id, structuredClone(WALL));
    tool = new DoorTool();
  });

  it('places a closed single door snapped to the wall', () => {
    click(tool, 5, 5.1);
    expect(doors()).toHaveLength(1);
    expect(doors()[0].wallId).toBe('w1');
    expect(doors()[0].state).toBe('closed');
    expect(doors()[0].position[1]).toBeCloseTo(5);
  });

  it('places nothing when the click is out of snap range', () => {
    click(tool, 5, 50);
    expect(doors()).toHaveLength(0);
  });

  it('selects a placed door on a single click without changing it', () => {
    click(tool, 5, 5.1);
    const placed = doors()[0];

    click(tool, 5, 5.1);
    expect(selectedIds()).toEqual([placed.id]);
    // DR10: inspecting must not mutate. Same state, same door, no second door.
    expect(doors()).toHaveLength(1);
    expect(doors()[0].state).toBe('closed');
  });

  it('clears the selection when the click misses every door', () => {
    click(tool, 5, 5.1);
    click(tool, 5, 5.1);
    expect(selectedIds()).toHaveLength(1);

    click(tool, 5, 50);
    expect(selectedIds()).toEqual([]);
  });

  it('cycles closed → open → locked → closed on double-click', () => {
    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('locked');

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(doors()).toHaveLength(1);
  });

  it('cycles once per double-click, not once per click of it', () => {
    click(tool, 5, 5.1);
    // Four clicks are two double-clicks: closed → open → locked, never further.
    doubleClick(tool, 5, 5.1);
    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('locked');
  });

  it('cycles an archway closed ↔ open, never into locked', () => {
    useStore.getState().updateToolSettings({ doorStyle: 'archway' });
    click(tool, 5, 5.1);
    expect(doors()[0].style).toBe('archway');
    expect(doors()[0].state).toBe('closed');

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');

    // A normal door would be 'locked' here — occlusion treats an archway as permanently
    // open and the renderer draws it no state dot, so 'locked' would mean nothing.
    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(doors()).toHaveLength(1);
  });

  it('undoes a cycle back to the previous state', () => {
    click(tool, 5, 5.1);
    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');
    undoManager.undo();
    expect(doors()[0].state).toBe('closed');
  });

  it('hit-tests where the door resolves, not where it was authored', () => {
    click(tool, 5, 5.1);
    const placed = doors()[0];

    // Node-edit the wall out from under the door: it now draws at y=7, and that
    // is where it has to be clickable — the authored position still says y=5.
    useStore.getState().updateWall(layer().id, 'w1', { points: [[0, 7], [10, 7]] });
    expect(doors()[0].position[1]).toBeCloseTo(5);

    click(tool, 5, 7);
    expect(doors()).toHaveLength(1);
    expect(selectedIds()).toEqual([placed.id]);
  });

  it('slides a door along its wall on drag, clamped to the wall ends', () => {
    click(tool, 5, 5.1);
    drag(tool, [5, 5], [8, 5.1]);
    expect(doors()[0].position[0]).toBeCloseTo(8);
    expect(doors()[0].position[1]).toBeCloseTo(5);

    // The wall runs x 0→10; a door of width 1 stops half a width short of the end.
    drag(tool, [8, 5], [10.8, 5]);
    expect(doors()[0].position[0]).toBeCloseTo(9.5);
    expect(doors()[0].wallId).toBe('w1');
  });

  it('leaves the door where it was when the drag leaves every wall', () => {
    click(tool, 5, 5.1);
    drag(tool, [5, 5], [5, 40]);
    expect(doors()[0].position[0]).toBeCloseTo(5);
    expect(doors()[0].position[1]).toBeCloseTo(5);
  });

  it('re-anchors to another wall when the drag crosses to it', () => {
    useStore.getState().addWall(layer().id, {
      ...structuredClone(WALL),
      id: 'w2',
      points: [[0, 9], [10, 9]],
    });
    click(tool, 5, 5.1);
    expect(doors()[0].wallId).toBe('w1');

    drag(tool, [5, 5], [5, 8.9]);
    expect(doors()[0].wallId).toBe('w2');
    expect(doors()[0].position[1]).toBeCloseTo(9);
  });

  it('undoes a whole drag in one step', () => {
    click(tool, 5, 5.1);
    drag(tool, [5, 5], [8, 5.1]);
    expect(doors()[0].position[0]).toBeCloseTo(8);

    undoManager.undo();
    expect(doors()[0].position[0]).toBeCloseTo(5);
  });

  it('puts the door back when Escape interrupts a drag', () => {
    click(tool, 5, 5.1);
    tool.onPointerMove({ x: 5, y: 5 });
    tool.onPointerDown({ x: 5, y: 5 });
    tool.onPointerMove({ x: 8, y: 5.1 });
    expect(doors()[0].position[0]).toBeCloseTo(8);

    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(doors()[0].position[0]).toBeCloseTo(5);
    // The abandoned slide never reaches the undo stack.
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();
    expect(doors()).toHaveLength(0);
  });

  it('treats a press that never passes the slop as a click, not a drag', () => {
    click(tool, 5, 5.1);
    const before = doors()[0].position[0];

    tool.onPointerMove({ x: 5, y: 5 });
    tool.onPointerDown({ x: 5, y: 5 });
    tool.onPointerMove({ x: 5.05, y: 5 });
    tool.onPointerUp({ x: 5.05, y: 5 });

    expect(doors()[0].position[0]).toBeCloseTo(before);
    expect(selectedIds()).toEqual([doors()[0].id]);
  });

  it('deletes the selected door and clears the selection', () => {
    click(tool, 5, 5.1);
    click(tool, 5, 5.1);
    expect(selectedIds()).toHaveLength(1);

    // Cursor parked away from the door: only the selection can be the target.
    tool.onPointerMove({ x: 5, y: 50 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(0);
    expect(selectedIds()).toEqual([]);

    undoManager.undo();
    expect(doors()).toHaveLength(1);
  });

  it('falls back to the hovered door on Delete when nothing is selected', () => {
    click(tool, 5, 5.1);
    useStore.getState().setSelectedIds([]);

    tool.onPointerMove({ x: 5, y: 5.1 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(0);

    undoManager.undo();
    expect(doors()).toHaveLength(1);
  });

  it('deletes nothing with no selection and no door under the cursor', () => {
    click(tool, 5, 5.1);
    useStore.getState().setSelectedIds([]);

    tool.onPointerMove({ x: 5, y: 50 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(1);
  });

  it('suppresses the placement ghost while hovering a placed door', () => {
    click(tool, 5, 5.1);
    tool.onPointerMove({ x: 5, y: 5.1 });
    expect(tool.getPreview()).toBeNull();

    tool.onPointerMove({ x: 9, y: 5.1 });
    expect(tool.getPreview()).not.toBeNull();
  });

  it('removing a wall cascades to the doors attached to it', () => {
    click(tool, 5, 5.1);
    expect(doors()).toHaveLength(1);

    undoManager.execute(createWallRemovalCommand(layer().id, 'w1'));
    expect(doors()).toHaveLength(0);
    expect(layer().standaloneWalls).toHaveLength(0);

    undoManager.undo();
    expect(doors()).toHaveLength(1);
    expect(layer().standaloneWalls).toHaveLength(1);
  });
});
