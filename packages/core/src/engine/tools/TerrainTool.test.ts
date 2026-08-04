import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    addChild = vi.fn();
  }
  class MockGraphics extends MockContainer {
    clear = vi.fn().mockReturnThis();
    destroy = vi.fn();
  }
  return { Container: MockContainer, Graphics: MockGraphics };
});

import { Container } from 'pixi.js';
import { TerrainTool } from './TerrainTool';
import { useStore } from '../../store/store';
import { setNotify } from '../../store/notify';
import type { RenderEngine } from '../RenderEngine';

describe('TerrainTool — map-level visibility (not editsActiveLayer)', () => {
  let tool: TerrainTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    // Terrain is global rather than layer-scoped, so the tool never declares
    // editsActiveLayer and checks mapSettings.terrain.visible itself instead
    // — nothing about engine/previewContainer is touched on this path.
    tool = new TerrainTool({} as RenderEngine, new Container() as never);
  });

  it('refuses to start a stroke and warns when terrain is hidden', () => {
    useStore.getState().setTerrainData({ visible: false });

    tool.onPointerDown({ x: 0, y: 0 });

    expect(tool.isActive()).toBe(false);
    expect(warning).toHaveBeenCalledWith('Terrain is hidden');
  });

  it('does not warn when terrain visibility is unset (default visible)', () => {
    tool.onPointerDown({ x: 0, y: 0 });
    // No renderer is registered in this unit run, so the stroke itself can't
    // start either way — only the warning path is under test here.
    expect(warning).not.toHaveBeenCalled();
  });
});
