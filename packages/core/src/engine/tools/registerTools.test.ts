import { describe, it, expect, vi } from 'vitest';

// Lightweight PixiJS stubs — every tool's constructor makes a Graphics/Container
// of some kind and adds it somewhere. Same shape as ToolManager.test.ts / DoorTool.test.ts.
vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    alpha = 1;
    tint = 0xffffff;
    scale = { x: 1 };
    children: MockContainer[] = [];
    addChild(child: MockContainer) { this.children.push(child); return child; }
    removeChildren() { const out = this.children; this.children = []; return out; }
    destroy = vi.fn();
  }
  class MockGraphics extends MockContainer {
    moveTo() { return this; }
    lineTo() { return this; }
    arc() { return this; }
    circle() { return this; }
    closePath() { return this; }
    stroke() { return this; }
    fill() { return this; }
    clear = vi.fn().mockReturnThis();
  }
  class MockSprite extends MockContainer {
    anchor = { set: vi.fn() };
    position = { set: vi.fn() };
    rotation = 0;
  }
  return { Container: MockContainer, Graphics: MockGraphics, Sprite: MockSprite };
});

import { Container } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import type { DrawingTool } from './DrawingTool';
import { ToolManager } from './ToolManager';
import { registerAllTools } from './registerTools';

/**
 * The exact tools a locked/hidden/missing active layer has to block at
 * pointerDown. Pinned as a set, not a loop of individual lookups, so a new
 * tool that forgets to declare `editsActiveLayer` (or a carve-out that
 * forgets to remove it) shows up as an unexpected member instead of quietly
 * passing.
 */
const EXPECTED_GATED = [
  'rectangle', 'polygon', 'regularPolygon', 'path', 'wall',
  'light', 'text', 'water', 'object', 'scatterBrush',
].sort();

/**
 * door is carved out deliberately (DR10 — locked-layer selection must still
 * work; see DoorTool.onPointerDown). select/ruler/terrain never write to a
 * layer at all, or gate their own way (terrain checks map-level visibility).
 */
const EXPECTED_UNGATED = ['select', 'ruler', 'terrain', 'door'].sort();

describe('registerAllTools — editsActiveLayer coverage', () => {
  it('gates exactly the layer-editing tools, and none of the others', () => {
    const manager = new ToolManager(new Container() as never);
    const registered: DrawingTool[] = [];
    const originalRegister = manager.registerTool.bind(manager);
    vi.spyOn(manager, 'registerTool').mockImplementation((tool: DrawingTool) => {
      registered.push(tool);
      originalRegister(tool);
    });

    const engine = {
      overlay: () => new Container() as never,
      worldToScreen: () => ({ x: 0, y: 0 }),
    } as unknown as RenderEngine;

    registerAllTools(manager, new Container() as never, engine, new Container() as never);

    const gated = registered.filter((t) => t.editsActiveLayer).map((t) => t.type).sort();
    const ungated = registered.filter((t) => !t.editsActiveLayer).map((t) => t.type).sort();

    expect(gated).toEqual(EXPECTED_GATED);
    expect(ungated).toEqual(EXPECTED_UNGATED);
  });
});
