import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { SelectTool } from './SelectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createDissolveGroupCommand, createGroupChildrenCommand } from '../../store/commands';
import { setNotify } from '../../store/notify';
import type { RenderEngine } from '../RenderEngine';
import type { AnyChild, DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild, ShapeChild } from '../../shared/types';

// jsdom has no real <canvas> 2D context (the `canvas` npm package isn't
// installed), but TransformGizmo's chip label measures text through one —
// the gizmo only gets exercised here, no other test drives SelectTool's
// object-selection path. A permissive stub is enough: any call answers with
// something numeric, any property is settable.
if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
const fakeCtx2D = new Proxy(
  {},
  {
    get: (target: Record<string, unknown>, prop) =>
      prop in target ? target[prop as string] : () => ({ width: 0, height: 0 }),
    set: (target: Record<string, unknown>, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = (() => fakeCtx2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// A realistic zoom (50 screen px per world unit) so the light's icon hit
// radius floors to the default 0.5 world cells instead of ballooning — at
// zoom 1 a 12px icon radius would swallow clicks anywhere near it.
const ZOOM = 50;

function makeEngine(): RenderEngine {
  const overlayContainer = new Container();
  const rect = { left: 0, top: 0 } as DOMRect;
  return {
    overlay: () => overlayContainer,
    canvas: () => ({ getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement,
    stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
    worldToScreen: (wx: number, wy: number) => ({ x: wx * ZOOM, y: wy * ZOOM }),
  } as unknown as RenderEngine;
}

function pointerEvent(clientX: number, clientY: number, extra: Partial<PointerEvent> = {}): PointerEvent {
  return { clientX, clientY, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra } as PointerEvent;
}

/** Screen-space drag from (0,0) covering a world-space delta, at ZOOM. */
function dragEvent(worldDx: number, worldDy: number): PointerEvent {
  return pointerEvent(worldDx * ZOOM, worldDy * ZOOM);
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function addAsset(position: { x: number; y: number }): AssetChild {
  const asset: AssetChild = {
    id: crypto.randomUUID(),
    name: 'Lamp',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'lamp',
    position,
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
  useStore.getState().addChild(layer().id, asset);
  return asset;
}

function addLight(position: { x: number; y: number }, attachedTo?: string): LightChild {
  const light: LightChild = {
    id: crypto.randomUUID(),
    name: 'Light 1',
    childType: 'light',
    visible: true,
    color: '#ffcc66',
    radius: 4,
    featherRadius: 2,
    intensity: 0.8,
    falloff: 'linear',
    position,
    attachedTo,
  };
  useStore.getState().addChild(layer().id, light);
  return light;
}

function findChild(id: string) {
  return layer().children.find((c) => c.id === id);
}

describe('SelectTool — M1 attached-light drag', () => {
  let tool: SelectTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    tool = new SelectTool(makeEngine());
  });

  it('moves an attached light by the same delta as its asset, in one undo', () => {
    const asset = addAsset({ x: 5, y: 5 });
    // Close enough to the asset centre to attach (< 0.5 cells), but the click
    // below lands on the asset's far corner so it doesn't also hit the light.
    const light = addLight({ x: 5.3, y: 5 }, asset.id);

    // Click-and-drag the asset: select-and-drag fires on the same pointerdown.
    tool.onPointerDown({ x: 4.5, y: 5.5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 6.5, y: 8.5 }, dragEvent(2, 3));
    tool.onPointerUp({ x: 6.5, y: 8.5 }, dragEvent(2, 3));

    const movedAsset = findChild(asset.id) as AssetChild;
    const movedLight = findChild(light.id) as LightChild;
    expect(movedAsset.position).toEqual({ x: 7, y: 8 });
    expect(movedLight.position).toEqual({ x: 7.3, y: 8 });
    // Radius untouched by the asset's move.
    expect(movedLight.radius).toBe(4);

    // One undo reverts both.
    undoManager.undo();
    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 5, y: 5 });
    expect((findChild(light.id) as LightChild).position).toEqual({ x: 5.3, y: 5 });
  });

  it('moving a light directly does not drag its host asset', () => {
    const asset = addAsset({ x: 5, y: 5 });
    const light = addLight({ x: 5.3, y: 5 }, asset.id);

    tool.onPointerDown({ x: 5.3, y: 5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 6.3, y: 6 }, dragEvent(1, 1));
    tool.onPointerUp({ x: 6.3, y: 6 }, dragEvent(1, 1));

    expect((findChild(light.id) as LightChild).position).toEqual({ x: 6.3, y: 6 });
    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 5, y: 5 });
  });

  it('does not drag a light attached to a different asset', () => {
    const asset = addAsset({ x: 5, y: 5 });
    const otherAsset = addAsset({ x: 20, y: 20 });
    const light = addLight({ x: 20.3, y: 20 }, otherAsset.id);

    tool.onPointerDown({ x: 5, y: 5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 7, y: 8 }, dragEvent(2, 3));
    tool.onPointerUp({ x: 7, y: 8 }, dragEvent(2, 3));

    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 7, y: 8 });
    expect((findChild(light.id) as LightChild).position).toEqual({ x: 20.3, y: 20 });
  });
});

describe('SelectTool — shape hover dwell gate', () => {
  let tool: SelectTool;
  let hover: Graphics;

  beforeEach(() => {
    vi.useFakeTimers();
    undoManager.clear();
    useStore.getState().resetToDefault();
    const engine = makeEngine();
    tool = new SelectTool(engine);
    hover = engine.overlay().children.find((c) => c.label === 'selectHover') as Graphics;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function addShape(): ShapeChild {
    const shape: ShapeChild = {
      id: crypto.randomUUID(),
      name: 'Floor',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    };
    useStore.getState().addChild(layer().id, shape);
    return shape;
  }

  const drawn = () => hover.getBounds().width > 0;

  it('crossing a shape never shows its outline', () => {
    addShape();
    tool.onPointerMove({ x: 12, y: 12 });
    expect(drawn()).toBe(false);
    // Leaves before the dwell elapses; the pending timer must not fire late.
    tool.onPointerMove({ x: 30, y: 30 });
    vi.advanceTimersByTime(500);
    expect(drawn()).toBe(false);
  });

  it('settling on a shape shows its outline after the dwell, and leaving re-arms it', () => {
    addShape();
    tool.onPointerMove({ x: 12, y: 12 });
    vi.advanceTimersByTime(500);
    expect(drawn()).toBe(true);
    // Further moves on the same shape keep it without waiting again.
    tool.onPointerMove({ x: 13, y: 13 });
    expect(drawn()).toBe(true);
    // Off the shape it clears, and coming back waits out the dwell again.
    tool.onPointerMove({ x: 30, y: 30 });
    expect(drawn()).toBe(false);
    tool.onPointerMove({ x: 12, y: 12 });
    expect(drawn()).toBe(false);
  });

  it('assets outline immediately — the gate is shapes-only', () => {
    addAsset({ x: 5, y: 5 });
    tool.onPointerMove({ x: 5, y: 5 });
    expect(drawn()).toBe(true);
  });

  it('a hovered prop moved from outside the canvas takes its outline along on the next frame', () => {
    const a = addAsset({ x: 5, y: 5 });
    useStore.getState().updateChild(layer().id, a.id, { rotation: Math.PI / 4 });
    tool.onPointerMove({ x: 5, y: 5 });
    const before = hover.getBounds();
    // The card's X field, Align or a nudge: the store moves, the pointer does not.
    useStore.getState().updateChild(layer().id, a.id, { position: { x: 9, y: 5 } });
    tool.updateGizmo();
    expect(hover.getBounds().x).toBeCloseTo(before.x + 4 * ZOOM);
    // Deleted from outside: the outline goes with it.
    useStore.getState().removeChild(layer().id, a.id);
    tool.updateGizmo();
    expect(drawn()).toBe(false);
  });

  it('a hovered water body hidden from outside the canvas leaves no outline', () => {
    const water = {
      id: 'lake', name: 'Lake', childType: 'water', visible: true, waterType: 'lake', textureId: '', tint: '#ffffff',
      opacity: 1, bankTextureId: '', bankWidth: 0, contours: [[[20, 20], [24, 20], [24, 24], [20, 24]]],
    } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, water);
    tool.onPointerMove({ x: 22, y: 22 });
    expect(drawn()).toBe(true);
    // The card's Hide button: the store hides it, the pointer does not move.
    useStore.getState().updateChild(layer().id, 'lake', { visible: false });
    tool.updateGizmo();
    expect(drawn()).toBe(false);
    expect(useStore.getState().selection.hoveredId).toBeNull();
  });
});

// The lock can land after the selection does — the layers panel selects a
// child on a locked layer by design, and a region cut survives a lock applied
// mid-gesture — so every write here has to re-check, and say why it refused.
describe('SelectTool — locked layer refusals', () => {
  let tool: SelectTool;
  let warning: ReturnType<typeof vi.fn<(message: string) => void>>;

  /** A 4×4 square region, the shape the legacy alt-drag cut works on. */
  const square: [number, number][][] = [[[0, 0], [4, 0], [4, 4], [0, 4]]];

  /**
   * The region commit and the transform session are reached through a gizmo
   * drag on the legacy overlay; called directly so the test isn't a
   * pixel-exact handle hunt for a guard that has nothing to do with handles.
   */
  function priv(t: SelectTool): {
    commitRegionTransform(base: [number, number][][], final: [number, number][][]): void;
    beginTransformSession(handle: 'move', fromCenter?: boolean): void;
  } {
    return t as unknown as ReturnType<typeof priv>;
  }

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new SelectTool(makeEngine());
  });

  it('refuses a region move on a locked layer', () => {
    useStore.getState().setActiveLayerId(layer().id);
    useStore.getState().setSelectedRegion(square);
    useStore.getState().updateLayer(layer().id, { locked: true });

    priv(tool).commitRegionTransform(square, [[[1, 1], [5, 1], [5, 5], [1, 5]]]);

    expect(warning).toHaveBeenCalledWith('Layer is locked');
    expect(undoManager.canUndo()).toBe(false);
    expect(layer().mergedFloor ?? []).toEqual([]);
  });

  it('refuses a region cut on a hidden layer', () => {
    useStore.getState().setActiveLayerId(layer().id);
    useStore.getState().setSelectedRegion(square);
    useStore.getState().updateLayer(layer().id, { visible: false });

    tool.onKeyDown({ key: 'Delete' } as KeyboardEvent);

    expect(warning).toHaveBeenCalledWith('Layer is hidden');
    expect(undoManager.canUndo()).toBe(false);
    // The region survives — nothing was cut, so nothing was deselected.
    expect(useStore.getState().selection.selectedRegion).toEqual(square);
  });

  it('refuses a region cut on a locked layer', () => {
    useStore.getState().setActiveLayerId(layer().id);
    useStore.getState().setSelectedRegion(square);
    useStore.getState().updateLayer(layer().id, { locked: true });

    tool.onKeyDown({ key: 'Delete' } as KeyboardEvent);

    expect(warning).toHaveBeenCalledWith('Layer is locked');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('says why a gizmo drag does nothing when the selection is all on a locked layer', () => {
    const asset = addAsset({ x: 5, y: 5 });
    useStore.getState().setSelectedIds([asset.id]);
    useStore.getState().updateLayer(layer().id, { locked: true });

    priv(tool).beginTransformSession('move');

    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('stays quiet when the drag comes up empty for any other reason', () => {
    priv(tool).beginTransformSession('move');
    expect(warning).not.toHaveBeenCalled();
  });
});

describe('SelectTool — props: lock, overhead, oriented gizmo', () => {
  let tool: SelectTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.setState((s) => {
      s.ui.seeUnderOverhead = false;
      s.grid.snapEnabled = false;
    });
    tool = new SelectTool(makeEngine());
  });

  function addProp(patch: Partial<AssetChild>): AssetChild {
    const a = addAsset(patch.position ?? { x: 5, y: 5 });
    useStore.getState().updateChild(layer().id, a.id, patch);
    return findChild(a.id) as AssetChild;
  }

  it('selects a locked prop on click, and a drag never moves it', () => {
    const rug = addProp({ locked: true, width: 2, height: 2 });
    tool.onPointerDown({ x: 5, y: 5 }, pointerEvent(250, 250));
    tool.onPointerMove({ x: 8, y: 8 }, pointerEvent(400, 400));
    tool.onPointerUp({ x: 8, y: 8 }, pointerEvent(400, 400));
    expect(useStore.getState().selection.selectedIds).toContain(rug.id);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('takes locked props into a marquee, so their card can unlock them', () => {
    const rug = addProp({ locked: true });
    const crate = addProp({ position: { x: 7, y: 7 } });
    tool.onPointerDown({ x: 0, y: 0 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 10, y: 10 }, pointerEvent(500, 500));
    tool.onPointerUp({ x: 10, y: 10 }, pointerEvent(500, 500));
    const ids = useStore.getState().selection.selectedIds;
    expect(ids).toContain(crate.id);
    expect(ids).toContain(rug.id);
  });

  it('picks an overhead prop before the prop drawn over it in the layer', () => {
    const canopy = addProp({ overhead: true, width: 3, height: 3 });
    const crate = addProp({});
    tool.onPointerDown({ x: 5, y: 5 }, pointerEvent(250, 250));
    tool.onPointerUp({ x: 5, y: 5 }, pointerEvent(250, 250));
    expect(useStore.getState().selection.selectedIds).toEqual([canopy.id]);
    expect(useStore.getState().selection.selectedIds).not.toContain(crate.id);
  });

  it('drags a mixed selection without moving the locked prop in it', () => {
    const rug = addProp({ locked: true, position: { x: 2, y: 2 } });
    const crate = addProp({});
    useStore.getState().setSelectedIds([rug.id, crate.id]);
    tool.updateGizmo();
    tool.onPointerDown({ x: 5, y: 5 }, pointerEvent(250, 250));
    tool.onPointerMove({ x: 6, y: 5 }, pointerEvent(300, 250));
    tool.onPointerUp({ x: 6, y: 5 }, pointerEvent(300, 250));
    expect((findChild(crate.id) as AssetChild).position).toEqual({ x: 6, y: 5 });
    expect((findChild(rug.id) as AssetChild).position).toEqual({ x: 2, y: 2 });
  });

  it('boxes the selection again once a lock on all of it is lifted, and keeps the box through Ungroup', () => {
    const gizmo = () => (tool as unknown as { gizmo: unknown }).gizmo;
    const ids = [addProp({ position: { x: 2, y: 2 } }), addProp({ position: { x: 6, y: 2 } }), addProp({})].map((c) => c.id);
    useStore.getState().setSelectedIds(ids);
    undoManager.execute(createGroupChildrenCommand(useStore.getState().layers, layer().id, ids, 'Supply corner', true)!);
    tool.updateGizmo();
    expect(gizmo()).not.toBeNull();
    // The group card's Lock all: nothing left to transform, so no box.
    for (const id of ids) useStore.getState().updateChild(layer().id, id, { locked: true });
    tool.updateGizmo();
    expect(gizmo()).toBeNull();
    // Unlock all, then Ungroup: the same three, still selected, get their box back.
    for (const id of ids) useStore.getState().updateChild(layer().id, id, { locked: false });
    const groupId = (findChild(ids[0]) as AssetChild).groupId!;
    undoManager.execute(createDissolveGroupCommand(useStore.getState().layers, layer().id, groupId)!);
    tool.updateGizmo();
    expect(gizmo()).not.toBeNull();
    expect(useStore.getState().selection.selectedIds).toEqual(ids);
  });

  it("resizes a quarter-turned prop along its own length from its E handle", () => {
    const table = addProp({ width: 4, height: 1, rotation: Math.PI / 2 });
    useStore.getState().setSelectedIds([table.id]);
    tool.updateGizmo();
    // Its own E side sits below its centre on screen: (5, 7) in the world.
    tool.onPointerDown({ x: 5, y: 7 }, pointerEvent(250, 350));
    tool.onPointerMove({ x: 5, y: 8 }, pointerEvent(250, 400));
    tool.onPointerUp({ x: 5, y: 8 }, pointerEvent(250, 400));
    const after = findChild(table.id) as AssetChild;
    expect(after.width).toBeCloseTo(5);
    expect(after.height).toBeCloseTo(1);
    expect(after.position.x).toBeCloseTo(5);
    expect(after.position.y).toBeCloseTo(5.5);
    expect(after.rotation).toBeCloseTo(Math.PI / 2);
    undoManager.undo();
    expect((findChild(table.id) as AssetChild).width).toBe(4);
  });

  it('carries an attached light once through a gizmo resize, in one undo', () => {
    const table = addProp({ width: 2, height: 1 });
    // On the table's E edge.
    const light = addLight({ x: 6, y: 5 }, table.id);
    useStore.getState().setSelectedIds([table.id]);
    tool.updateGizmo();
    tool.onPointerDown({ x: 6, y: 5 }, pointerEvent(300, 250));
    tool.onPointerMove({ x: 8, y: 5 }, pointerEvent(400, 250));
    tool.onPointerUp({ x: 8, y: 5 }, pointerEvent(400, 250));
    expect((findChild(table.id) as AssetChild).width).toBeCloseTo(4);
    const moved = findChild(light.id) as LightChild;
    expect(moved.position.x).toBeCloseTo(8);
    expect(moved.position.y).toBeCloseTo(5);
    undoManager.undo();
    expect((findChild(light.id) as LightChild).position).toEqual({ x: 6, y: 5 });
    expect((findChild(table.id) as AssetChild).width).toBe(2);
  });
});
