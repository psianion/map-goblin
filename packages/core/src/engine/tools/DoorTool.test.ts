import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PixiJS stubs. The tool owns a real display object now — the placement ghost —
 * and the rows below read what landed in it, so the stubs only have to record
 * parentage and swallow every draw call.
 */
vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    alpha = 1;
    tint = 0xffffff;
    children: MockContainer[] = [];
    destroyed = false;
    addChild(child: MockContainer) { this.children.push(child); return child; }
    removeChildren() { const out = this.children; this.children = []; return out; }
    destroy() { this.destroyed = true; }
  }
  class MockGraphics extends MockContainer {
    moveTo() { return this; }
    lineTo() { return this; }
    arc() { return this; }
    circle() { return this; }
    closePath() { return this; }
    stroke() { return this; }
    fill() { return this; }
  }
  class MockSprite extends MockContainer {
    anchor = { set: vi.fn() };
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    rotation = 0;
  }
  return { Container: MockContainer, Graphics: MockGraphics, Sprite: MockSprite };
});

// No pack art in a unit run: every door falls back to its vector glyph.
vi.mock('../assetPackInstance', () => ({
  getAssetPackManager: () => ({ getTextureOrNull: () => null }),
}));
vi.mock('../../assets/textureLoader', () => ({ resolveTexture: () => ({ width: 0 }) }));

import { Container } from 'pixi.js';
import { DoorTool, clampDoorWidth } from './DoorTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createWallRemovalCommand } from '../../store/commands';
import { createDungeonLayer } from '../../store/factories';
import { setNotify } from '../../store/notify';
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

/** A standalone wall of `length` cells along y = `y`, starting at x = 0. */
function addWall(id: string, length: number, y: number): void {
  useStore.getState().addWall(layer().id, {
    ...structuredClone(WALL),
    id,
    points: [[0, y], [length, y]],
  });
}

/** The tool's ghost container — the one thing it adds to the preview layer. */
interface Ghost {
  children: unknown[];
  tint: number;
  alpha: number;
}

describe('DoorTool', () => {
  let tool: DoorTool;
  let ghost: Ghost;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addWall(layer().id, structuredClone(WALL));
    const preview = new Container();
    tool = new DoorTool(preview);
    ghost = preview.children[0] as unknown as Ghost;
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

  it('places a door on a press with no hover before it', () => {
    // Every helper above hovers first, which is why this went unseen. Activating
    // the tool clears the snap and opens the tool popover over the canvas, so
    // the press that dismisses the popover is routinely the first pointer event
    // the tool sees — and a press that waited for a hover placed nothing and
    // said nothing, so one door took two identical clicks. Touch never hovers.
    tool.onPointerDown({ x: 5, y: 5.1 });
    tool.onPointerUp({ x: 5, y: 5.1 });
    expect(doors()).toHaveLength(1);
    expect(doors()[0].wallId).toBe('w1');
  });

  it('still refuses an unhovered press out of snap range', () => {
    tool.onPointerDown({ x: 5, y: 50 });
    tool.onPointerUp({ x: 5, y: 50 });
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
    // open and it renders as the open art regardless, so 'locked' would mean nothing.
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
    expect(ghost.children).toHaveLength(0);

    tool.onPointerMove({ x: 9, y: 5.1 });
    expect(ghost.children.length).toBeGreaterThan(0);
  });

  // ── Placement ghost ──────────────────────────────────────────────────────

  it('ghosts the door a click would place, faded and untinted', () => {
    tool.onPointerMove({ x: 5, y: 5.1 });
    expect(ghost.children.length).toBeGreaterThan(0);
    expect(ghost.alpha).toBe(0.5);
    expect(ghost.tint).toBe(0xffffff);
    // Nothing was committed by hovering.
    expect(doors()).toHaveLength(0);
  });

  it('shows no ghost with no wall in snap range', () => {
    tool.onPointerMove({ x: 5, y: 5.1 });
    expect(ghost.children.length).toBeGreaterThan(0);

    tool.onPointerMove({ x: 5, y: 50 });
    expect(ghost.children).toHaveLength(0);
  });

  it('drops the ghost once the door it was showing is placed', () => {
    click(tool, 5, 5.1);
    expect(doors()).toHaveLength(1);
    expect(ghost.children).toHaveLength(0);
  });

  it('drops the ghost when the tool is cancelled', () => {
    tool.onPointerMove({ x: 5, y: 5.1 });
    tool.cancel();
    expect(ghost.children).toHaveLength(0);
  });

  it('reds the ghost where the click would overlap a placed door', () => {
    click(tool, 5, 5.1);
    // Outside the door's hit radius (0.5) but inside the overlap span (1.0):
    // the click would be silently refused, so the ghost has to say so.
    tool.onPointerMove({ x: 5.6, y: 5.1 });
    expect(ghost.children.length).toBeGreaterThan(0);
    expect(ghost.tint).toBe(0xcc3344);

    tool.onPointerDown({ x: 5.6, y: 5.1 });
    expect(doors()).toHaveLength(1);
  });

  it('reds the ghost where the door would be wider than its wall', () => {
    // The width setting overhangs the wall it is aimed at.
    addWall('long', 7, 20);
    useStore.getState().updateToolSettings({ doorWidth: 8 });

    tool.onPointerMove({ x: 3, y: 20.1 });
    expect(ghost.children.length).toBeGreaterThan(0);
    expect(ghost.tint).toBe(0xcc3344);

    tool.onPointerDown({ x: 3, y: 20.1 });
    expect(doors()).toHaveLength(0);
  });

  // ── The chosen width, and only it ────────────────────────────────────────
  // A door used to swell to fill any wall of six cells or less, so the width in
  // the panel was a suggestion the tool ignored on exactly the short walls a DM
  // is most likely to be aiming at. It is now the width, everywhere.

  it('keeps the chosen width on a short wall instead of filling it', () => {
    addWall('stub', 3, 20);
    click(tool, 0.5, 20.1);

    expect(doors()[0].width).toBe(1);
    expect(doors()[0].position[1]).toBeCloseTo(20);
  });

  it('keeps the chosen width on a floor-ring edge too', () => {
    useStore.getState().updateLayer(layer().id, {
      mergedFloor: [[[0, 30], [4, 30], [4, 34], [0, 34]]],
    });
    click(tool, 1, 30.1);

    const placed = doors()[0];
    expect(placed.wallId).toBe(''); // FLOOR_ANCHORED — the ring has no stable id
    expect(placed.width).toBe(1);
    expect(placed.position[0]).toBeCloseTo(1);
  });

  it('keeps the width setting on a long wall', () => {
    click(tool, 5, 5.1);
    expect(doors()[0].width).toBe(1);
    expect(doors()[0].position[0]).toBeCloseTo(5);
  });

  it('accepts a door exactly as wide as its wall', () => {
    // The too-wide rule has to be `>` past an epsilon, or a door sized to the
    // wall it is aimed at would be refused on float noise alone.
    addWall('stub', 2, 20);
    useStore.getState().updateToolSettings({ doorWidth: 2 });
    click(tool, 1, 20.1);
    expect(doors()).toHaveLength(1);
    expect(doors()[0].width).toBeCloseTo(2);
  });

  it('refuses a door wider than the short wall it was aimed at', () => {
    // What auto-fit used to paper over: the wall is too short, so the ghost
    // reds and the click does nothing rather than silently shrinking the door.
    addWall('stub', 1.5, 20);
    useStore.getState().updateToolSettings({ doorWidth: 3 });

    tool.onPointerMove({ x: 0.75, y: 20.1 });
    expect(ghost.tint).toBe(0xcc3344);
    tool.onPointerDown({ x: 0.75, y: 20.1 });
    expect(doors()).toHaveLength(0);
  });

  // ── Per-style minimum widths ─────────────────────────────────────────────
  // A double door is two leaves, a portcullis a row of bars, an archway a jamb
  // either side: none of them survive being squeezed into a single cell.

  it('widens a narrow setting up to the style minimum', () => {
    // The setting would otherwise stand at 1.
    useStore.getState().updateToolSettings({ doorStyle: 'double', doorWidth: 1 });
    click(tool, 5, 5.1);
    expect(doors()[0].width).toBe(2);
  });

  it('leaves a single door on the width it was given', () => {
    useStore.getState().updateToolSettings({ doorStyle: 'single', doorWidth: 1 });
    click(tool, 5, 5.1);
    expect(doors()[0].width).toBe(1);
  });

  it('refuses a style too wide for the opening it was aimed at', () => {
    // A double widens to 2, wider than the 1.5-cell wall, so the existing
    // too-wide rule reds the ghost and eats the click.
    addWall('stub', 1.5, 20);
    useStore.getState().updateToolSettings({ doorStyle: 'double' });

    tool.onPointerMove({ x: 0.75, y: 20.1 });
    expect(ghost.tint).toBe(0xcc3344);
    tool.onPointerDown({ x: 0.75, y: 20.1 });
    expect(doors()).toHaveLength(0);
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

describe('DoorTool — locked layer (DR10 carve-out, F4/F2)', () => {
  let tool: DoorTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addWall(layer().id, structuredClone(WALL));
    const preview = new Container();
    tool = new DoorTool(preview);
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  it('still selects a door for inspection on a locked layer (DR10)', () => {
    click(tool, 5, 5.1);
    const placed = doors()[0];
    useStore.getState().updateLayer(layer().id, { locked: true });

    click(tool, 5, 5.1);
    expect(selectedIds()).toEqual([placed.id]);
    expect(doors()[0].state).toBe('closed');
    expect(warning).not.toHaveBeenCalled();
  });

  it('blocks cycling a door on a locked layer', () => {
    click(tool, 5, 5.1);
    useStore.getState().updateLayer(layer().id, { locked: true });

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('blocks placing a new door on a locked layer', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    click(tool, 8, 5.1);
    expect(doors()).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('blocks dragging a selected door on a locked layer, warning once the drag starts', () => {
    click(tool, 5, 5.1);
    useStore.getState().updateLayer(layer().id, { locked: true });
    // The press itself is a select (allowed); crossing DRAG_SLOP is what a
    // locked layer refuses.
    drag(tool, [5, 5], [8, 5.1]);
    expect(doors()[0].position[0]).toBeCloseTo(5);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('refuses placement and selection on a hidden layer', () => {
    click(tool, 5, 5.1);
    const before = doors()[0];
    useStore.getState().setSelectedIds([]);
    useStore.getState().updateLayer(layer().id, { visible: false });

    click(tool, 5, 5.1);
    // Nothing to inspect if the layer isn't even drawn — selection is refused too.
    expect(selectedIds()).toEqual([]);
    expect(doors()).toEqual([before]);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });

  it('blocks deleting the selected door on a locked layer (F2)', () => {
    click(tool, 5, 5.1);
    click(tool, 5, 5.1); // select
    useStore.getState().updateLayer(layer().id, { locked: true });

    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('blocks deleting the hovered door on a hidden layer (F2)', () => {
    click(tool, 5, 5.1);
    useStore.getState().setSelectedIds([]);
    tool.onPointerMove({ x: 5, y: 5.1 });
    useStore.getState().updateLayer(layer().id, { visible: false });

    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(doors()).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });
});

describe('DoorTool — effective visibility under solo (F1)', () => {
  let tool: DoorTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addWall(layer().id, structuredClone(WALL));
    const preview = new Container();
    tool = new DoorTool(preview);
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  // The gate used to read the raw `visible` flag, which solo never touches —
  // soloing a different layer left the active-but-unsoloed one editable even
  // though the panel and canvas both show it hidden.
  it('blocks placing a new door once another layer is soloed', () => {
    const other = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(other);
    useStore.getState().toggleSoloLayer(other.id); // active layer is now effectively hidden

    click(tool, 8, 5.1);
    expect(doors()).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });

  it('blocks cycling a door once another layer is soloed', () => {
    click(tool, 5, 5.1);
    const other = createDungeonLayer('Layer 2');
    useStore.getState().addLayer(other);
    useStore.getState().toggleSoloLayer(other.id);

    doubleClick(tool, 5, 5.1);
    expect(doors()[0].state).toBe('closed');
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });
});

describe('clampDoorWidth', () => {
  // Single→double bumps up; the reverse used to leave the bumped width behind,
  // which on a 1-cell wall is the overhang the placement tool draws in red.
  it('clamps down to the host wall when the style no longer needs the width', () => {
    expect(clampDoorWidth(2, 'single', 1)).toBe(1);
  });

  it('leaves a wide single alone on a wall long enough to hold it', () => {
    expect(clampDoorWidth(2, 'single', 6)).toBe(2);
  });

  it('still raises a narrow door to its style minimum', () => {
    expect(clampDoorWidth(1, 'double', 6)).toBe(2);
  });

  it('keeps the style minimum when the wall is too short for any legal width', () => {
    // Nothing fits, so narrowing further would only swap one invalid door for another.
    expect(clampDoorWidth(2, 'double', 1)).toBe(2);
  });

  it('does not clamp a detached door, which has no opening to fit', () => {
    expect(clampDoorWidth(3, 'single', Infinity)).toBe(3);
  });

  it('agrees with the placement rule the ghost turns red on', () => {
    const wallLength = 1.5;
    for (const width of [0.5, 1, 2, 3, 4]) {
      expect(clampDoorWidth(width, 'single', wallLength)).toBeLessThanOrEqual(wallLength);
    }
  });
});
