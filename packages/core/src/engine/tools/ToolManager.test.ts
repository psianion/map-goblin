import { describe, it, expect, vi } from 'vitest';

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

function fakeTool(type: ToolType, cursor?: string): DrawingTool {
  return {
    type,
    cursor,
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
