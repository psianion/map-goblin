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

  it('cycles closed → open → locked → closed instead of stacking doors', () => {
    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');

    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');

    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('locked');

    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(doors()).toHaveLength(1);
  });

  it('cycles an archway closed ↔ open, never into locked', () => {
    useStore.getState().updateToolSettings({ doorStyle: 'archway' });
    click(tool, 5, 5.1);
    expect(doors()[0].style).toBe('archway');
    expect(doors()[0].state).toBe('closed');

    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');

    // A normal door would be 'locked' here — occlusion treats an archway as permanently
    // open and the renderer draws it no state dot, so 'locked' would mean nothing.
    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(doors()).toHaveLength(1);
  });

  it('undoes a cycle back to the previous state', () => {
    click(tool, 5, 5.1);
    click(tool, 5, 5.1);
    expect(doors()[0].state).toBe('open');
    undoManager.undo();
    expect(doors()[0].state).toBe('closed');
  });

  it('deletes the hovered door on Delete, and undo restores it', () => {
    click(tool, 5, 5.1);
    tool.onPointerMove({ x: 5, y: 5.1 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(0);

    undoManager.undo();
    expect(doors()).toHaveLength(1);
  });

  it('deletes nothing when the cursor is not over a door', () => {
    click(tool, 5, 5.1);
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
