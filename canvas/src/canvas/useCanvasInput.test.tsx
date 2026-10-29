// Keyboard routing out of the canvas — the DOM layer between a real keypress
// and the thing that answers it.
//
// The chain is: document keydown → handleKeyDown → (node-edit Escape, outline
// vertex Delete, the node key table) → the global shortcut table → the active
// tool. Every rung of it was covered except the routing itself, which is where
// "Ctrl+Z does nothing while I'm editing a wall" would live: the node table
// claims Delete and Tab, and if it ever claimed a Ctrl combo the undo binding
// below it would never be reached.
//
// These mount the real hook on a real element and dispatch real KeyboardEvents,
// so nothing between the key and the store is stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand } from '@/store/commands';
import { seedTestWallSets, resetAssetPackManager } from '@dnd/core/src/testing/seedCatalog';
import { setNotify } from '@dnd/core/src/store/notify';
import { currentWallNodes } from '@/engine/wallNodeOverlay';
import { toggleNodeEditAt } from './wallNodeEdit';
import {
  useCanvasInput,
  setToolManager,
  setDimensionHud,
  registerCanvasPressHandler,
  registerInputMiddleware,
  roomUnder,
} from './useCanvasInput';
import { setRoomPicking } from '@dnd/core/src/engine/hitTest';
import { openCanvasMenuRef } from '@/components/canvas/canvasMenuRef';
import type { DimensionHud } from './dimensionHud';
import { WallTool } from '@dnd/core/src/engine/tools/WallTool';
import type { RenderEngine } from '@/engine/RenderEngine';
import type { ToolManager } from '@/engine/tools/ToolManager';
import type { DungeonLayer } from '@/store/types';
import type { AssetChild, WallSegment } from '@/shared/types';
import type { Polygon } from '@/types/geometry';

const RING: Polygon = [[0, 0], [12, 0], [12, 8], [0, 8]];

/** A drawn wall clear of RING, on the test wall set so it has stones to pick. */
const WALL: WallSegment = {
  id: 'wall-1',
  points: [[0, 20], [12, 20]],
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  width: 0.5,
  roughness: 0,
};

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

const wall = () => layer().standaloneWalls.find((w) => w.id === WALL.id)!;

/**
 * The hook, live, on a detached container holding a canvas — everything the
 * keydown path touches is document-level, so the element never needs to be in
 * the tree. The engine is only dereferenced by the pointer handlers.
 */
let unmount: (() => void) | null = null;
let canvasEl: HTMLCanvasElement | null = null;

/** A stage that keeps its zoom between calls, for the wheel tests. */
interface StubStage {
  scale: { x: number; set(v: number): void };
  position: { x: number; y: number };
}

function mountInput(stage?: StubStage): void {
  const container = document.createElement('div');
  canvasEl = document.createElement('canvas');
  // jsdom has no pointer capture; the drag paths call it unconditionally.
  (canvasEl as unknown as Record<string, unknown>).setPointerCapture ??= () => {};
  (canvasEl as unknown as Record<string, unknown>).releasePointerCapture ??= () => {};
  container.appendChild(canvasEl);
  const ref = { current: container };
  const engine = {
    stage: () => stage ?? { scale: { x: 32 }, position: { x: 0, y: 0 } },
    // Identity mapping, so a test can aim a pointer event at a world point.
    screenToWorld: (x: number, y: number) => ({ x, y }),
    worldToScreen: (x: number, y: number) => ({ x, y }),
  } as unknown as RenderEngine;
  unmount = renderHook(() => useCanvasInput(ref, engine)).unmount;
}

interface Mods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** Dispatch a real keydown and hand back the event, so preventDefault is observable. */
function press(key: string, mods: Mods = {}, from: EventTarget = document): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    metaKey: !!mods.meta,
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(e);
  return e;
}

/**
 * A drawn wall in node-edit mode with one undoable step already committed.
 *
 * The step is a rock added through a real command, so undo is observable as
 * the layer's child count coming back — the same thing a DM watches when they
 * press Ctrl+Z mid-edit.
 */
function seedWallInEditMode(): { committedCount: number } {
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    standaloneWalls: [structuredClone(WALL)],
    style: { ...l.style, wallTextureSetId: 'GG_Test' },
  } as Partial<DungeonLayer>);

  toggleNodeEditAt({ x: 6, y: 20 });
  if (useStore.getState().tools.nodeEditWallId !== WALL.id) {
    throw new Error('fixture did not enter wall node mode');
  }

  const rock: AssetChild = {
    id: 'rock-extra',
    name: 'Rock',
    childType: 'asset',
    objectType: 'asset',
    assetId: 'gg-demo:rock_1_2x1_object_A',
    position: { x: 4, y: 4 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    visible: true,
  };
  undoManager.execute(new AddChildCommand('Add rock', l.id, rock));
  return { committedCount: layer().children.length };
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  resetAssetPackManager();
  setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  seedTestWallSets(['GG_Test']);
  mountInput();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  canvasEl = null;
  setToolManager(null);
  setDimensionHud(null);
  document.body.innerHTML = '';
});

describe('Ctrl+Z reaches undo while wall node mode is active', () => {
  it('undoes with a stone selected', () => {
    const { committedCount } = seedWallInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);
    expect(useStore.getState().tools.selectedNodeT).toBe(t);

    const e = press('z', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount - 1);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    // The node table never saw it, so the wall carries no edit.
    expect(wall().nodeEdits).toBeUndefined();
    // And the mode itself survives an undo — you keep editing where you were.
    expect(useStore.getState().tools.nodeEditWallId).toBe(WALL.id);
  });

  it('undoes with nothing selected', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().selectNode(null);

    press('z', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount - 1);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('undoes on Cmd+Z too', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);

    press('z', { meta: true });

    expect(layer().children).toHaveLength(committedCount - 1);
  });

  // The mechanism that makes the above work: the node key table is skipped
  // outright for Ctrl/Cmd combos, so it can never swallow one on its way to the
  // global bindings. Delete is the sharpest probe — the table claims it bare,
  // and must not claim it with Ctrl held.
  it('the node key table is skipped for Ctrl combos, even on a key it owns', () => {
    const { committedCount } = seedWallInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);

    const e = press('Delete', { ctrl: true });

    // Not routed to the table (no stone removed), not routed to the global
    // delete binding either (ctrl+delete is unbound) — it simply falls off the end.
    expect(wall().nodeEdits).toBeUndefined();
    expect(layer().children).toHaveLength(committedCount);
    expect(e.defaultPrevented).toBe(false);
    expect(useStore.getState().tools.selectedNodeT).toBe(t);
  });
});

describe('redo', () => {
  it('Ctrl+Y redoes', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    press('z', { ctrl: true });
    expect(layer().children).toHaveLength(committedCount - 1);

    press('y', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount);
    expect(useStore.getState().ui.canRedo).toBe(false);
  });

  it('Ctrl+Shift+Z redoes', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    press('z', { ctrl: true });

    press('z', { ctrl: true, shift: true });

    expect(layer().children).toHaveLength(committedCount);
  });
});

describe('precedence between the node table and the global table', () => {
  it('bare Delete with a stone selected goes to the node table, not the shape delete', () => {
    const { committedCount } = seedWallInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);
    // A shape selected as well, so the global Delete binding has something to
    // take if it ever gets the key.
    useStore.getState().setSelectedIds([layer().children[0].id]);

    const e = press('Delete');

    // The stone was taken out of the wall, and nothing else was deleted.
    expect(wall().nodeEdits?.some((edit) => edit.removed)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(layer().children).toHaveLength(committedCount);
    expect(useStore.getState().selection.selectedIds).toHaveLength(1);
  });

  it('a key the node table does not claim falls through to the global table', () => {
    seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    const before = useStore.getState().tools.curveMode;

    const e = press('c');

    expect(useStore.getState().tools.curveMode).toBe(!before);
    expect(e.defaultPrevented).toBe(true);
  });

  it('with nothing picked, the session still owns Tab, so the v2 dock never sees it', () => {
    seedWallInEditMode();
    expect(useStore.getState().tools.selectedNodeT).toBeNull();

    const e = press('Tab');

    expect(e.defaultPrevented).toBe(true);
    expect(useStore.getState().tools.nodeEditWallId).toBe(WALL.id);
  });

  it('with nothing picked, Delete stays in the session instead of taking the shape', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().setSelectedIds([layer().children[0].id]);

    const e = press('Delete');

    expect(e.defaultPrevented).toBe(true);
    expect(layer().children).toHaveLength(committedCount);
    expect(useStore.getState().selection.selectedIds).toHaveLength(1);
  });

  it('outside an edit session Tab is not claimed', () => {
    const e = press('Tab');
    expect(e.defaultPrevented).toBe(false);
  });

  it('Escape leaves node edit first, and only clears solo on the next press', () => {
    seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    useStore.getState().toggleSoloLayer(layer().id);
    const solo = useStore.getState().ui.solo;
    expect(solo).not.toBeNull();

    const first = press('Escape');
    expect(useStore.getState().tools.nodeEditWallId).toBeNull();
    expect(first.defaultPrevented).toBe(true);
    // Node edit returned early — one Escape does one thing.
    expect(useStore.getState().ui.solo).toEqual(solo);

    press('Escape');
    expect(useStore.getState().ui.solo).toBeNull();
  });
});

describe('focus in a text field', () => {
  function focusedInput(): HTMLInputElement {
    const input = document.createElement('input');
    document.body.appendChild(input);
    return input;
  }

  it('swallows a bare shortcut', () => {
    seedWallInEditMode();
    const before = useStore.getState().tools.curveMode;

    press('c', {}, focusedInput());

    expect(useStore.getState().tools.curveMode).toBe(before);
  });

  it('still lets Ctrl+Z through', () => {
    const { committedCount } = seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);

    press('z', { ctrl: true }, focusedInput());

    expect(layer().children).toHaveLength(committedCount - 1);
  });
});

// A left-click that misses every node handle while a node-edit mode is active
// must be consumed, not passed down to the tools: the fall-through used to
// object-select the wall stone under the cursor, and the drag that followed a
// missed grab moved or rotated it. The same guard covers the shape outline
// mode; the wall path stands in for both here.
describe('a miss-click in wall node mode never reaches the tools', () => {
  function clickCanvas(): void {
    // jsdom has no PointerEvent; the handler only reads MouseEvent fields.
    // (-500, -500) maps to world (-500, -500) — a miss on any fixture stone.
    const e = new MouseEvent('pointerdown', {
      button: 0,
      clientX: -500,
      clientY: -500,
      bubbles: true,
      cancelable: true,
    });
    canvasEl!.dispatchEvent(e);
  }

  function spyManager(): { onPointerDown: ReturnType<typeof vi.fn> } {
    const manager = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn(() => false),
      cancelActive: vi.fn(),
      switchTool: vi.fn(),
      getCursor: vi.fn(() => 'default'),
      getHoverCursor: vi.fn(() => null),
      getActivePreview: vi.fn(() => null),
    };
    setToolManager(manager as unknown as ToolManager);
    return manager;
  }

  it('in wall mode the click clears the stone selection and stops', () => {
    seedWallInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    const manager = spyManager();

    clickCanvas();

    expect(useStore.getState().tools.selectedNodeTs).toHaveLength(0);
    expect(useStore.getState().tools.nodeEditWallId).toBe(WALL.id);
    expect(manager.onPointerDown).not.toHaveBeenCalled();
  });

  it('outside node mode the same click still reaches the tools', () => {
    const manager = spyManager();

    clickCanvas();

    expect(manager.onPointerDown).toHaveBeenCalledTimes(1);
  });
});

// The dimension readout follows the chain it measures: every way a chain ends without
// the pointer moving (Escape, a tool switch, a pointer taken away) has to take the
// readout with it, or "0 · 0 ft" hangs on the canvas after the wall is gone.
describe('the dimension readout goes with a cancelled wall chain', () => {
  let hud: { update: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; visible: boolean };
  let wall: WallTool;

  beforeEach(() => {
    hud = { update: vi.fn(), hide: vi.fn(), visible: false };
    hud.update.mockImplementation(() => (hud.visible = true));
    hud.hide.mockImplementation(() => (hud.visible = false));
    setDimensionHud(hud as unknown as DimensionHud);

    // The real wall tool behind a manager that forwards to it, as ToolManager does.
    wall = new WallTool();
    const manager = {
      onPointerDown: vi.fn((p, e) => wall.onPointerDown(p, e)),
      onPointerMove: vi.fn((p, e) => wall.onPointerMove(p, e)),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn((e: KeyboardEvent) => {
        const was = wall.isActive();
        wall.onKeyDown(e);
        return was;
      }),
      cancelActive: vi.fn(() => wall.cancel()),
      switchTool: vi.fn(() => wall.cancel()),
      getCursor: vi.fn(() => 'crosshair'),
      getHoverCursor: vi.fn(() => null),
      getActivePreview: vi.fn(() => {
        const preview = wall.getPreview();
        return preview ? { toolType: 'wall', preview } : null;
      }),
    };
    setToolManager(manager as unknown as ToolManager);
    useStore.getState().setActiveTool('wall');
  });

  function startWall(): void {
    canvasEl!.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 40, bubbles: true, cancelable: true }),
    );
    expect(wall.isActive()).toBe(true);
    expect(hud.visible).toBe(true);
  }

  it('hides on Escape', () => {
    startWall();
    press('Escape');
    expect(wall.isActive()).toBe(false);
    expect(hud.visible).toBe(false);
  });

  it('hides when the tool is switched mid-chain', () => {
    startWall();
    useStore.getState().setActiveTool('rectangle');
    expect(wall.isActive()).toBe(false);
    expect(hud.visible).toBe(false);
  });

  it('hides when the pointer is taken away mid-chain', () => {
    startWall();
    canvasEl!.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    expect(wall.isActive()).toBe(false);
    expect(hud.visible).toBe(false);
  });
});

// Rooms on the canvas: a press an overlay claims (a suggestion's ✓ / ✕) never reaches
// the tools; a double-click in a room edits the floor under its anchor; a right-click
// on a room opens the room's own menu.
describe('rooms', () => {
  const floor = () =>
    ({
      id: 'floor-1',
      name: 'Floor',
      childType: 'shape',
      shapeType: 'rectangle',
      visible: true,
      contours: [[[0, 0], [12, 0], [12, 8], [0, 8]]],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    }) as never;

  function seedRoom(): void {
    const l = layer();
    useStore.getState().setActiveLayerId(l.id);
    useStore.getState().updateLayer(l.id, { children: [floor()], mergedFloor: [RING] } as Partial<DungeonLayer>);
    useStore.getState().setRooms(l.id, [
      { id: 'hall', name: 'Hall', number: 1, anchor: [6, 4], face: [[0, 0], [12, 0], [12, 8], [0, 8]] },
    ]);
  }

  afterEach(() => setRoomPicking(false));

  it('a press an overlay claims never reaches the tools', () => {
    const manager = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn(() => false),
      cancelActive: vi.fn(),
      switchTool: vi.fn(),
      getCursor: vi.fn(() => 'default'),
      getHoverCursor: vi.fn(() => null),
      getActivePreview: vi.fn(() => null),
    };
    setToolManager(manager as unknown as ToolManager);
    const claim = vi.fn((sx: number) => sx === 7);
    const unreg = registerCanvasPressHandler(claim);
    canvasEl!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 7, clientY: 7, bubbles: true }));
    expect(manager.onPointerDown).not.toHaveBeenCalled();
    canvasEl!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 3, clientY: 3, bubbles: true }));
    expect(manager.onPointerDown).toHaveBeenCalledTimes(1);
    unreg();
  });

  it('a double-click in a room edits the floor under its anchor', () => {
    seedRoom();
    setRoomPicking(true);
    useStore.getState().setActiveTool('select');
    canvasEl!.dispatchEvent(new MouseEvent('dblclick', { clientX: 2, clientY: 2, bubbles: true, cancelable: true }));
    expect(useStore.getState().tools.shapeNodeEditId).toBe('floor-1');
  });

  it('roomUnder answers only where rooms pick', () => {
    seedRoom();
    expect(roomUnder({ x: 2, y: 2 }, 32)).toBeNull();
    setRoomPicking(true);
    expect(roomUnder({ x: 2, y: 2 }, 32)).toEqual({ layerId: layer().id, anchor: [6, 4] });
  });

  it("a right-click on a room selects it and opens the room's menu", () => {
    seedRoom();
    setRoomPicking(true);
    const open = vi.fn();
    openCanvasMenuRef.current = open;
    canvasEl!.dispatchEvent(new MouseEvent('contextmenu', { clientX: 2, clientY: 2, bubbles: true, cancelable: true }));
    expect(useStore.getState().selection.selectedIds).toEqual(['hall']);
    expect(open.mock.calls[0][0].target).toEqual({ kind: 'room', roomId: 'hall', layerId: layer().id });
    openCanvasMenuRef.current = null;
  });
});

// The Props tool shapes its stamp with the wheel and right-click, so both reach the
// active tool before the canvas zooms or opens its menu. Ctrl+wheel (and a trackpad
// pinch, which arrives as one) always zooms.
describe('wheel and right-click reach the tool', () => {
  let stage: StubStage;
  let tool: { onWheel: ReturnType<typeof vi.fn>; onContextMenu: ReturnType<typeof vi.fn>; onPointerDown: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    unmount?.();
    stage = { scale: { x: 32, set(v: number) { this.x = v; } }, position: { x: 0, y: 0 } };
    mountInput(stage);
    tool = { onWheel: vi.fn(() => true), onContextMenu: vi.fn(() => true), onPointerDown: vi.fn() };
    setToolManager({
      ...tool,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn(() => false),
      cancelActive: vi.fn(),
      switchTool: vi.fn(),
      getCursor: vi.fn(() => 'crosshair'),
      getHoverCursor: vi.fn(() => null),
      getActivePreview: vi.fn(() => null),
    } as unknown as ToolManager);
  });

  const wheel = (init: WheelEventInit): void => {
    canvasEl!.dispatchEvent(new WheelEvent('wheel', { clientX: 5, clientY: 6, bubbles: true, cancelable: true, ...init }));
  };

  it('a wheel the tool takes does not zoom', () => {
    wheel({ deltaY: 100 });
    expect(tool.onWheel).toHaveBeenCalledTimes(1);
    expect(tool.onWheel.mock.calls[0][1]).toEqual({ x: 5, y: 6 });
    expect(stage.scale.x).toBe(32);
  });

  it('a wheel the tool declines zooms, Shift+wheel (deltaX on Windows) included', () => {
    tool.onWheel.mockReturnValue(false);
    wheel({ deltaY: -100 });
    expect(stage.scale.x).toBeCloseTo(32 * 1.1);
    wheel({ deltaX: 100, shiftKey: true });
    expect(stage.scale.x).toBeCloseTo(32);
  });

  it('Ctrl+wheel always zooms and never reaches the tool', () => {
    wheel({ deltaY: -100, ctrlKey: true });
    expect(tool.onWheel).not.toHaveBeenCalled();
    expect(stage.scale.x).toBeCloseTo(32 * 1.1);
  });

  it('a right-click the tool takes opens no menu; one it declines does', () => {
    const open = vi.fn();
    openCanvasMenuRef.current = open;
    const rightClick = () =>
      canvasEl!.dispatchEvent(new MouseEvent('contextmenu', { clientX: 2, clientY: 3, bubbles: true, cancelable: true }));
    rightClick();
    expect(tool.onContextMenu).toHaveBeenCalledTimes(1);
    expect(tool.onContextMenu.mock.calls[0][0]).toEqual({ x: 2, y: 3 });
    expect(open).not.toHaveBeenCalled();
    tool.onContextMenu.mockReturnValue(false);
    rightClick();
    expect(open).toHaveBeenCalledTimes(1);
    openCanvasMenuRef.current = null;
  });

  it('a right-click on a locked prop still selects it and opens its menu (for Unlock)', () => {
    tool.onContextMenu.mockReturnValue(false);
    const open = vi.fn();
    openCanvasMenuRef.current = open;
    useStore.getState().addChild(layer().id, {
      id: 'crate',
      name: 'Crate',
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: 'test:crate',
      position: { x: 2, y: 3 },
      rotation: 0,
      scale: 1,
      width: 1,
      height: 1,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
      locked: true,
    });
    canvasEl!.dispatchEvent(new MouseEvent('contextmenu', { clientX: 2, clientY: 3, bubbles: true, cancelable: true }));
    expect(useStore.getState().selection.selectedIds).toEqual(['crate']);
    expect(open.mock.calls[0][0].target).toEqual({ kind: 'child', childId: 'crate' });
    openCanvasMenuRef.current = null;
  });

  it('a right-click picks an overhead prop above a higher layer, unless the DM sees under overhead', () => {
    tool.onContextMenu.mockReturnValue(false);
    const open = vi.fn();
    openCanvasMenuRef.current = open;
    const prop = (id: string, overhead: boolean) => ({
      id,
      name: id,
      childType: 'asset' as const,
      visible: true,
      objectType: 'asset' as const,
      assetId: `test:${id}`,
      position: { x: 2, y: 3 },
      rotation: 0,
      scale: 1,
      width: 1,
      height: 1,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
      overhead,
    });
    useStore.getState().addChild(layer().id, prop('canopy', true));
    useStore.getState().addLayer({ ...structuredClone(layer()), id: 'layer-2', children: [prop('crate', false)] });
    const rightClick = (): void => {
      canvasEl!.dispatchEvent(new MouseEvent('contextmenu', { clientX: 2, clientY: 3, bubbles: true, cancelable: true }));
    };
    rightClick();
    expect(useStore.getState().selection.selectedIds).toEqual(['canopy']);
    useStore.setState((s) => {
      s.ui.seeUnderOverhead = true;
    });
    useStore.getState().setSelectedIds([]);
    rightClick();
    expect(useStore.getState().selection.selectedIds).toEqual(['crate']);
    useStore.setState((s) => {
      s.ui.seeUnderOverhead = false;
    });
    openCanvasMenuRef.current = null;
  });

  it('the Props tool gets the raw cursor, since it snaps by footprint itself', () => {
    const unreg = registerInputMiddleware((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const down = (): void => {
      canvasEl!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 3.3, clientY: 4.8, bubbles: true }));
    };
    useStore.getState().setActiveTool('scatterBrush');
    down();
    expect(tool.onPointerDown.mock.calls[0][0]).toEqual({ x: 3.3, y: 4.8 });
    useStore.getState().setActiveTool('rectangle');
    down();
    expect(tool.onPointerDown.mock.calls[1][0]).toEqual({ x: 3, y: 5 });
    unreg();
  });
});
