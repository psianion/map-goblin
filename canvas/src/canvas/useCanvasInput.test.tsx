// Keyboard routing out of the canvas — the DOM layer between a real keypress
// and the thing that answers it.
//
// The chain is: document keydown → handleKeyDown → (node-edit Escape, outline
// vertex Delete, the band/stone key table) → the global shortcut table → the
// active tool. Every rung of it was covered except the routing itself, which is
// where "Ctrl+Z does nothing while I'm editing a cave band" would live: the
// band table claims Delete and Tab, and if it ever claimed a Ctrl combo the
// undo binding below it would never be reached.
//
// These mount the real hook on a real element and dispatch real KeyboardEvents,
// so nothing between the key and the store is stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand } from '@/store/commands';
import {
  seedCaveBandPack,
  caveBandChildren,
  resetAssetPackManager,
} from '@dnd/core/src/testing/seedCatalog';
import { setNotify } from '@dnd/core/src/store/notify';
import { currentWallNodes } from '@/engine/wallNodeOverlay';
import { toggleNodeEditAt } from './wallNodeEdit';
import { useCanvasInput, setToolManager } from './useCanvasInput';
import type { RenderEngine } from '@/engine/RenderEngine';
import type { ToolManager } from '@/engine/tools/ToolManager';
import type { DungeonLayer } from '@/store/types';
import type { Polygon } from '@/types/geometry';

const RING: Polygon = [[0, 0], [12, 0], [12, 8], [0, 8]];

/** What this fixture's band refuses every gesture with — it has no floor under it. */
const NO_FLOOR = 'this cave wall has no floor outline under it to move';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

const status = () => useStore.getState().tools.bandDragStatus;

/**
 * The hook, live, on a detached container holding a canvas — everything the
 * keydown path touches is document-level, so the element never needs to be in
 * the tree. The engine is only dereferenced by the pointer handlers.
 */
let unmount: (() => void) | null = null;
let canvasEl: HTMLCanvasElement | null = null;

function mountInput(): void {
  const container = document.createElement('div');
  canvasEl = document.createElement('canvas');
  // jsdom has no pointer capture; the drag paths call it unconditionally.
  (canvasEl as unknown as Record<string, unknown>).setPointerCapture ??= () => {};
  (canvasEl as unknown as Record<string, unknown>).releasePointerCapture ??= () => {};
  container.appendChild(canvasEl);
  const ref = { current: container };
  const engine = {
    stage: () => ({ scale: { x: 32 }, position: { x: 0, y: 0 } }),
    // Identity mapping, so a test can aim a pointer event at a world point.
    screenToWorld: (x: number, y: number) => ({ x, y }),
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
 * A cave band in node-edit mode with one undoable step already committed.
 *
 * The step is a fourth rock added through a real command, so undo is observable
 * as the layer's child count coming back — the same thing a DM watches when
 * they press Ctrl+Z after a band gesture.
 */
function seedBandInEditMode(): { span: number; committedCount: number } {
  const { children, span } = caveBandChildren();
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    children,
    mergedFloor: [RING],
    style: { ...l.style, wallTextureSetId: undefined },
  } as Partial<DungeonLayer>);

  toggleNodeEditAt({ x: span / 2, y: 20 });
  if (useStore.getState().tools.nodeEditWallId !== 'band:0') {
    throw new Error('fixture did not enter band node mode');
  }

  const extra = { ...structuredClone(children[0]), id: 'rock-extra' };
  undoManager.execute(new AddChildCommand('Add rock', l.id, extra));
  return { span, committedCount: layer().children.length };
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  resetAssetPackManager();
  setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  seedCaveBandPack();
  mountInput();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  canvasEl = null;
  setToolManager(null);
  document.body.innerHTML = '';
});

describe('Ctrl+Z reaches undo while band node mode is active', () => {
  it('undoes with a joint selected', () => {
    const { committedCount } = seedBandInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);
    expect(useStore.getState().tools.selectedNodeT).toBe(t);

    const e = press('z', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount - 1);
    expect(useStore.getState().ui.canUndo).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    // The band table never saw it, so it left no refusal behind.
    expect(status()).toBeNull();
    // And the mode itself survives an undo — you keep editing where you were.
    expect(useStore.getState().tools.nodeEditWallId).toBe('band:0');
  });

  it('undoes with nothing selected', () => {
    const { committedCount } = seedBandInEditMode();
    useStore.getState().selectNode(null);

    press('z', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount - 1);
    expect(useStore.getState().ui.canUndo).toBe(false);
  });

  it('undoes on Cmd+Z too', () => {
    const { committedCount } = seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);

    press('z', { meta: true });

    expect(layer().children).toHaveLength(committedCount - 1);
  });

  // The mechanism that makes the above work: the band/stone key table is
  // skipped outright for Ctrl/Cmd combos, so it can never swallow one on its
  // way to the global bindings. Delete is the sharpest probe — the band claims
  // it bare, and must not claim it with Ctrl held.
  it('the band key table is skipped for Ctrl combos, even on a key it owns', () => {
    const { committedCount } = seedBandInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);
    useStore.getState().setBandDragStatus(null);

    const e = press('Delete', { ctrl: true });

    // Not routed to the band (no refusal), not routed to the global delete
    // binding either (ctrl+delete is unbound) — it simply falls off the end.
    expect(status()).toBeNull();
    expect(layer().children).toHaveLength(committedCount);
    expect(e.defaultPrevented).toBe(false);
    expect(useStore.getState().tools.selectedNodeT).toBe(t);
  });
});

describe('redo', () => {
  it('Ctrl+Y redoes', () => {
    const { committedCount } = seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    press('z', { ctrl: true });
    expect(layer().children).toHaveLength(committedCount - 1);

    press('y', { ctrl: true });

    expect(layer().children).toHaveLength(committedCount);
    expect(useStore.getState().ui.canRedo).toBe(false);
  });

  it('Ctrl+Shift+Z redoes', () => {
    const { committedCount } = seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    press('z', { ctrl: true });

    press('z', { ctrl: true, shift: true });

    expect(layer().children).toHaveLength(committedCount);
  });
});

describe('precedence between the band table and the global table', () => {
  it('bare Delete with a joint selected goes to the band, not the shape delete', () => {
    const { committedCount } = seedBandInEditMode();
    const t = currentWallNodes()[1].t;
    useStore.getState().selectNode(t);
    // A shape selected as well, so the global Delete binding has something to
    // take if it ever gets the key.
    useStore.getState().setSelectedIds([layer().children[0].id]);
    useStore.getState().setBandDragStatus(null);

    const e = press('Delete');

    // The straighten was asked for and refused by this floorless fixture — the
    // point is that the band answered at all.
    expect(status()).toEqual({ refusal: NO_FLOOR });
    expect(e.defaultPrevented).toBe(true);
    // Nothing was deleted, and the undo stack is where the commit left it.
    expect(layer().children).toHaveLength(committedCount);
    expect(useStore.getState().selection.selectedIds).toHaveLength(1);
  });

  it('a key the band does not claim falls through to the global table', () => {
    seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    const before = useStore.getState().tools.roughMode;

    const e = press('x');

    expect(useStore.getState().tools.roughMode).toBe(!before);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Escape leaves node edit first, and only clears solo on the next press', () => {
    seedBandInEditMode();
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
    seedBandInEditMode();
    const before = useStore.getState().tools.roughMode;

    press('x', {}, focusedInput());

    expect(useStore.getState().tools.roughMode).toBe(before);
  });

  it('still lets Ctrl+Z through', () => {
    const { committedCount } = seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);

    press('z', { ctrl: true }, focusedInput());

    expect(layer().children).toHaveLength(committedCount - 1);
  });
});

// A left-click that misses every joint handle while a node-edit mode is active
// must be consumed, not passed down to the tools: the fall-through used to
// object-select the wall stone under the cursor, and the drag that followed a
// missed joint grab moved or rotated it. The same guard covers the shape
// outline mode; the band path stands in for both here.
describe('a miss-click in band node mode never reaches the tools', () => {
  function clickCanvas(): void {
    // jsdom has no PointerEvent; the handler only reads MouseEvent fields.
    // (-500, -500) maps to world (-500, -500) — a miss on any fixture joint.
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

  it('in band mode the click clears the joint selection and stops', () => {
    seedBandInEditMode();
    useStore.getState().selectNode(currentWallNodes()[1].t);
    const manager = spyManager();

    // The stub engine maps every click to world (0, 0), far from any joint.
    clickCanvas();

    expect(useStore.getState().tools.selectedNodeTs).toHaveLength(0);
    expect(useStore.getState().tools.nodeEditWallId).toBe('band:0');
    expect(manager.onPointerDown).not.toHaveBeenCalled();
  });

  it('outside node mode the same click still reaches the tools', () => {
    const manager = spyManager();

    clickCanvas();

    expect(manager.onPointerDown).toHaveBeenCalledTimes(1);
  });
});
