import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { MapBoundaryRenderer } from './MapBoundaryRenderer';
import { buildSceneGraph } from '../sceneGraph';
import { runExportPipeline } from '../export/exportPipeline';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';

// buildSceneGraph's heavier neighbours need a GPU/2d canvas; the scene-graph
// wiring under test here is just which container the boundary hangs off.
vi.mock('../water/waterAnimation', () => ({
  initWaterAnimation: () => {},
  getWaterFilter: () => null,
}));
vi.mock('../terrain/TerrainRenderer', () => ({
  TerrainRenderer: class {
    container = new Container();
  },
  setTerrainRenderer: () => {},
}));
vi.mock('../lighting', () => ({ LightingRenderer: class {} }));
vi.mock('../fogTransition', () => ({ FogTransition: class {} }));

/** Minimal engine stub: identity screenToWorld/worldToScreen at a given zoom. */
function makeEngine(zoom = 20, panX = 0, panY = 0): RenderEngine {
  return {
    viewport: () => ({ width: 800, height: 600, dpr: 1 }),
    stage: () => new Container(),
    overlay: () => new Container(),
    ticker: () => ({ add: () => {}, remove: () => {} }),
    screenToWorld: (sx: number, sy: number) => ({ x: (sx - panX) / zoom, y: (sy - panY) / zoom }),
    worldToScreen: (wx: number, wy: number) => ({ x: wx * zoom + panX, y: wy * zoom + panY }),
  } as unknown as RenderEngine;
}

function setFixedSize(fixedSize: { width: number; height: number } | null) {
  useStore.setState((s) => ({ mapSettings: { ...s.mapSettings, fixedSize } }));
}

function strokeSpy(renderer: MapBoundaryRenderer) {
  return (renderer as unknown as { graphics: { geometry?: unknown } }).graphics;
}

describe('MapBoundaryRenderer', () => {
  afterEach(() => setFixedSize(null));

  it('draws nothing for an expanding map (fixedSize null)', () => {
    setFixedSize(null);
    const renderer = new MapBoundaryRenderer();
    renderer.update(makeEngine());

    expect(renderer.container.visible).toBe(false);
    expect(strokeSpy(renderer)).toBeDefined();
    // Nothing was ever drawn into the Graphics.
    expect(renderer.container.getLocalBounds().width).toBe(0);
  });

  it('draws the frame rectangle at the fixed size, in screen space', () => {
    setFixedSize({ width: 30, height: 20 });
    const renderer = new MapBoundaryRenderer();
    renderer.update(makeEngine(20, 100, 50));

    expect(renderer.container.visible).toBe(true);
    const b = renderer.container.getLocalBounds();
    // (0,0)-(30,20) cells at zoom 20, panned by (100,50) → 600x400px at (100,50).
    // (bounds include the 1px stroke, half a pixel on each side)
    expect(Math.round(b.x)).toBe(100);
    expect(Math.round(b.y)).toBe(50);
    expect(Math.round(b.width)).toBe(601);
    expect(Math.round(b.height)).toBe(401);
  });

  it('stays a 1px hairline when zoomed in (stroke is screen-space)', () => {
    setFixedSize({ width: 30, height: 20 });
    const renderer = new MapBoundaryRenderer();

    renderer.update(makeEngine(20));
    const thin = renderer.container.getLocalBounds().width;
    renderer.update(makeEngine(200));
    const zoomed = renderer.container.getLocalBounds().width;

    // Bounds grow with zoom by the frame size only — the stroke's contribution
    // to them (half a pixel each side) is the same 1px at both zooms.
    expect(thin - 30 * 20).toBeCloseTo(1, 5);
    expect(zoomed - 30 * 200).toBeCloseTo(1, 5);
  });

  it('skips the redraw while the frame sits at the same place on screen', () => {
    setFixedSize({ width: 30, height: 20 });
    const renderer = new MapBoundaryRenderer();
    const graphics = (renderer as unknown as { graphics: { clear: () => void } }).graphics;
    let clears = 0;
    const realClear = graphics.clear.bind(graphics);
    graphics.clear = () => {
      clears++;
      return realClear();
    };

    renderer.update(makeEngine(20));
    expect(clears).toBe(1);
    renderer.update(makeEngine(20));
    expect(clears).toBe(1);
    renderer.update(makeEngine(20, 40)); // camera panned
    expect(clears).toBe(2);
  });

  it('export renders the world container and nothing else', async () => {
    const rendered: unknown[] = [];
    const worldContainer = new Container();
    const engine = {
      createRenderTexture: () => ({ destroy: () => {} }),
      renderToTexture: (c: unknown) => rendered.push(c),
      renderer: () => ({ extract: { image: async () => ({}) } }),
    } as unknown as RenderEngine;
    const sceneGraph = {
      worldContainer,
      gridRenderer: { container: { visible: true } },
      lightingRenderer: { renderInto: () => {} },
    } as unknown as Parameters<typeof runExportPipeline>[1];
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
      getContext() {
        return { drawImage: () => {} };
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    };

    await runExportPipeline(engine, sceneGraph, [], {
      format: 'png',
      pxPerCell: 64,
      includeGrid: true,
      mapName: 'm',
    });

    expect(rendered).toEqual([worldContainer]);
  });

  it('is excluded from export: it hangs off the overlay, never the world container', () => {
    // Given the test above, anything outside the worldContainer subtree cannot
    // reach an exported image.
    const sceneGraph = buildSceneGraph(makeEngine(), { editorGuides: true });
    const boundary = sceneGraph.mapBoundaryRenderer!.container;

    expect(boundary.parent).toBe(sceneGraph.overlayContainer);
    let node: Container | null = boundary;
    while (node) {
      expect(node).not.toBe(sceneGraph.worldContainer);
      node = node.parent as Container | null;
    }
  });

  describe('editor-only gate', () => {
    it('is not built at all without editorGuides — the table gets no boundary', () => {
      const sceneGraph = buildSceneGraph(makeEngine());

      expect(sceneGraph.mapBoundaryRenderer).toBeNull();
      // Not merely hidden: nothing labelled mapBoundary reached the overlay.
      expect(
        sceneGraph.overlayContainer.children.some((c) => c.label === 'mapBoundary'),
      ).toBe(false);
    });

    it('defaults to off, so a caller that forgets the flag fails safe', () => {
      // Same call the session GameRenderer makes — no options object at all.
      expect(buildSceneGraph(makeEngine()).mapBoundaryRenderer).toBeNull();
    });

    it('is built and mounted when the editor asks for guides', () => {
      const sceneGraph = buildSceneGraph(makeEngine(), { editorGuides: true });

      expect(sceneGraph.mapBoundaryRenderer).not.toBeNull();
      expect(sceneGraph.mapBoundaryRenderer!.container.parent).toBe(sceneGraph.overlayContainer);
    });
  });
});
