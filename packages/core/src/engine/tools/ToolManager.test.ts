import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lightweight PixiJS stubs — ToolManager's constructor makes a Graphics and adds it.
vi.mock('pixi.js', () => {
  class MockGraphics {
    label = '';
    clear = vi.fn().mockReturnThis();
    destroy = vi.fn();
  }
  class MockContainer {
    addChild = vi.fn();
    scale = { x: 1 };
  }
  return { Graphics: MockGraphics, Container: MockContainer };
});

import { Container } from 'pixi.js';
import { ToolManager } from './ToolManager';
import type { DrawingTool, ToolType } from './DrawingTool';
import { useStore } from '../../store/store';
import { setNotify } from '../../store/notify';
import { TERRAIN_PANEL_ID } from '../../store/types';

function fakeTool(type: ToolType, cursor?: string, editsActiveLayer?: boolean): DrawingTool {
  return {
    type,
    cursor,
    editsActiveLayer,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onKeyDown: vi.fn(),
    getPreview: () => null,
    cancel: vi.fn(),
    isActive: () => false,
  };
}

describe('ToolManager.getCursor', () => {
  it('returns "default" when no tool is active', () => {
    const tm = new ToolManager(new Container() as never);
    expect(tm.getCursor()).toBe('default');
  });

  it('returns the active tool\'s declared cursor', () => {
    const tm = new ToolManager(new Container() as never);
    tm.registerTool(fakeTool('rectangle', 'crosshair'));
    tm.switchTool('rectangle');
    expect(tm.getCursor()).toBe('crosshair');
  });

  it('falls back to "default" for a tool with no cursor (e.g. select)', () => {
    const tm = new ToolManager(new Container() as never);
    tm.registerTool(fakeTool('select'));
    tm.switchTool('select');
    expect(tm.getCursor()).toBe('default');
  });
});

describe('ToolManager.onPointerDown — editsActiveLayer guard', () => {
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  function dungeonLayerId(): string {
    const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
    if (!layer) throw new Error('default state has no dungeon layer');
    return layer.id;
  }

  it('forwards pointerDown to an unlocked, visible dungeon layer', () => {
    useStore.getState().setActiveLayerId(dungeonLayerId());
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('blocks and warns when the active layer is locked', () => {
    const layerId = dungeonLayerId();
    useStore.getState().setActiveLayerId(layerId);
    useStore.getState().updateLayer(layerId, { locked: true });
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('blocks and warns when the active layer is hidden', () => {
    const layerId = dungeonLayerId();
    useStore.getState().setActiveLayerId(layerId);
    useStore.getState().updateLayer(layerId, { visible: false });
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });

  it('blocks and warns when the active layer id does not resolve to any layer', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Select a layer first');
  });

  // D5(a): "Select a layer first" reads as a bug when the Terrain row is
  // visibly selected in the panel — same no-editable-layer case, worded for it.
  it('warns with the terrain-aware message when the Terrain row is active', () => {
    useStore.getState().setActiveLayerId(TERRAIN_PANEL_ID);
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Terrain is selected — pick a layer to draw on');
  });

  it('blocks and warns when the active layer is the background layer', () => {
    const bg = useStore.getState().layers.find((l) => l.type === 'background');
    if (!bg) throw new Error('default state has no background layer');
    useStore.getState().setActiveLayerId(bg.id);
    useStore.getState().setActiveTool('rectangle');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('rectangle', 'crosshair', true);
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Select a layer first');
  });

  it('never blocks a tool without editsActiveLayer, even on a locked/hidden/missing layer', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    useStore.getState().setActiveTool('select');
    const tm = new ToolManager(new Container() as never);
    const tool = fakeTool('select'); // no editsActiveLayer
    tm.registerTool(tool);

    tm.onPointerDown({ x: 0, y: 0 }, {} as PointerEvent);

    expect(tool.onPointerDown).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });
});
