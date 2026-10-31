import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { BAND_REACH, computeMapWorldBounds, runExportPipeline } from './exportPipeline';
import type { RenderEngine } from '../RenderEngine';
import { buildSceneGraph, getLayerEntries, type SceneGraph } from '../sceneGraph';
import { useStore } from '../../store/store';
import { setAuthoredLookHold, setEditorDesk, type AuthoredLookOptions } from '../editorDesk';

const { bandSets } = vi.hoisted(() => ({ bandSets: new Set<string>() }));
vi.mock('../../assets/packCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assets/packCatalog')>()),
  isBandSet: (id: string | undefined) => !!id && bandSets.has(id),
}));
// buildSceneGraph's heavier neighbours need a GPU/2d canvas; the overhead test below only
// needs the real container tree.
vi.mock('../terrain/TerrainRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terrain/TerrainRenderer')>()),
  TerrainRenderer: class {
    container = new Container();
  },
  setTerrainRenderer: () => {},
}));
vi.mock('../lighting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lighting')>()),
  LightingRenderer: class {},
}));
vi.mock('../fogTransition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../fogTransition')>()),
  FogTransition: class {},
}));
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function makeWater(outer: [number, number][], visible = true): WaterChild {
  return {
    id: `water-${outer[0]?.join('_') ?? 'empty'}`,
    name: 'Water',
    childType: 'water',
    visible,
    waterType: 'lake',
    contours: [outer],
    textureId: 'water-still-a-01',
    tint: '#9fc8e8',
    opacity: 0.9,
    bankTextureId: '',
    bankWidth: 0.5,
  };
}

/** A dungeon layer carrying the given floor polygon and water children. */
function layerWith(
  mergedFloor: [number, number][][] | null,
  children: WaterChild[] = [],
): DungeonLayer {
  return { ...dungeonLayer(), mergedFloor, children };
}

beforeEach(() => useStore.getState().resetToDefault());

describe('computeMapWorldBounds', () => {
  it('takes terrain bounds as an argument instead of only reading the live store', () => {
    const b = computeMapWorldBounds([layerWith(null)], { minX: -30, minY: -20, maxX: 30, maxY: 20 });
    expect(b.minX).toBeLessThanOrEqual(-30);
    expect(b.maxX).toBeGreaterThanOrEqual(30);
    // Explicitly passing null opts out of the store read entirely
    expect(computeMapWorldBounds([layerWith(null)], null)).toEqual({
      minX: -5, minY: -5, maxX: 5, maxY: 5,
    });
  });

  it('falls back to a 10x10 grid when there is no geometry at all', () => {
    expect(computeMapWorldBounds([layerWith(null)])).toEqual({
      minX: -5, minY: -5, maxX: 5, maxY: 5,
    });
  });

  it('covers a water-only layer that has no floor geometry', () => {
    // Regression: bounds used to skip any layer without mergedFloor, so a map
    // made purely of water exported as the empty 10x10 default.
    const b = computeMapWorldBounds([layerWith(null, [makeWater([[0, 0], [20, 0], [20, 12], [0, 12]])])]);
    expect(b.maxX).toBeGreaterThanOrEqual(20);
    expect(b.maxY).toBeGreaterThanOrEqual(12);
    expect(b.minX).toBeLessThanOrEqual(0);
  });

  it('extends floor bounds to take in water that spills past them', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const withoutWater = computeMapWorldBounds([layerWith(floor)]);
    const withWater = computeMapWorldBounds([
      layerWith(floor, [makeWater([[10, 0], [30, 0], [30, 10], [10, 10]])]),
    ]);

    expect(withWater.maxX).toBeGreaterThan(withoutWater.maxX);
    expect(withWater.maxX).toBeGreaterThanOrEqual(30);
    expect(withWater.minX).toBe(withoutWater.minX);
  });

  it('ignores hidden water bodies', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const baseline = computeMapWorldBounds([layerWith(floor)]);
    const hidden = computeMapWorldBounds([
      layerWith(floor, [makeWater([[10, 0], [30, 0], [30, 10], [10, 10]], false)]),
    ]);

    expect(hidden).toEqual(baseline);
  });

  it('extends bounds to cover painted terrain', () => {
    const floor: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const baseline = computeMapWorldBounds([layerWith(floor)]);

    useStore.getState().setTerrainData({ bounds: { minX: -20, minY: -8, maxX: 12, maxY: 10 } });
    const withTerrain = computeMapWorldBounds([layerWith(floor)]);

    expect(withTerrain.minX).toBeLessThanOrEqual(-20);
    expect(withTerrain.minY).toBeLessThanOrEqual(-8);
    expect(withTerrain.minX).toBeLessThan(baseline.minX);
  });

  it('covers a terrain-only map with no floor and no water', () => {
    useStore.getState().setTerrainData({ bounds: { minX: -3, minY: -3, maxX: 40, maxY: 25 } });
    const b = computeMapWorldBounds([layerWith(null)]);

    expect(b.maxX).toBeGreaterThanOrEqual(40);
    expect(b.maxY).toBeGreaterThanOrEqual(25);
  });
});

describe('runExportPipeline', () => {
  it('hands the scene back and frees the texture when the render throws', async () => {
    const destroy = vi.fn();
    const position = { x: 3, y: 4, set(x: number, y: number) { this.x = x; this.y = y; } };
    const scale = { x: 0.5, set(v: number) { this.x = v; } };
    const gridContainer = { visible: true };
    const sceneGraph = {
      worldContainer: { position, scale },
      gridRenderer: { container: gridContainer },
      lightingRenderer: { renderInto: vi.fn() },
    } as unknown as SceneGraph;
    const engine = {
      createRenderTexture: () => ({ destroy }),
      renderToTexture: () => { throw new Error('render failed'); },
      renderer: vi.fn(),
    } as unknown as RenderEngine;

    await expect(
      runExportPipeline(engine, sceneGraph, useStore.getState().layers, {
        format: 'png',
        pxPerCell: 64,
        includeGrid: false,
        mapName: 'Test',
      }),
    ).rejects.toThrow('render failed');

    expect(position).toMatchObject({ x: 3, y: 4 });
    expect(scale.x).toBe(0.5);
    expect(gridContainer.visible).toBe(true);
    expect(destroy).toHaveBeenCalledWith(true);
  });
});

describe('runExportPipeline: the file', () => {
  type Calls = {
    rt: unknown[][];
    lighting: number;
    drawn: unknown[][];
    held: AuthoredLookOptions[];
    position: { x: number; y: number } | null;
    canvas: number[];
  };

  /** A scene and engine that record what the export asked of them. */
  function rig() {
    const calls: Calls = { rt: [], lighting: 0, drawn: [], held: [], position: null, canvas: [] };
    const position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } };
    const scale = { x: 1, set(v: number) { this.x = v; } };
    const sceneGraph = {
      worldContainer: { position, scale },
      gridRenderer: { container: { visible: true } },
      lightingRenderer: { renderInto: () => { calls.lighting++; } },
    } as unknown as SceneGraph;
    const engine = {
      viewport: () => ({ width: 800, height: 600, dpr: 2 }),
      createRenderTexture: (...args: unknown[]) => {
        calls.rt.push(args);
        return { destroy: () => {} };
      },
      renderToTexture: () => {
        calls.position = { x: position.x, y: position.y };
      },
      renderer: () => ({ extract: { image: async () => ({ naturalWidth: 2816, naturalHeight: 2048 }) } }),
    } as unknown as RenderEngine;
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
      constructor(w: number, h: number) {
        calls.canvas = [w, h];
      }
      getContext() {
        return { drawImage: (...args: unknown[]) => calls.drawn.push(args.slice(1)) };
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    };
    setAuthoredLookHold((opts) => {
      calls.held.push(opts);
      return () => {};
    });
    return { engine, sceneGraph, calls };
  }

  /** A 9.5x6.5 room: 10.1x7.1 cells with its walls, so an 11x8 file. */
  function room() {
    const dl = dungeonLayer();
    useStore.setState({
      layers: useStore.getState().layers.map((l) =>
        l.id === dl.id ? { ...dl, mergedFloor: [[[2, 3], [11.5, 3], [11.5, 9.5], [2, 9.5]]] } : l,
      ) as DungeonLayer[],
    });
    return useStore.getState().layers;
  }

  const opts = { format: 'png' as const, pxPerCell: 128, includeGrid: false, mapName: 'Room' };

  beforeEach(() => {
    useStore.getState().resetToDefault();
    setEditorDesk({ desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' });
  });

  afterEach(() => {
    setEditorDesk(null);
    setAuthoredLookHold(null);
  });

  it('renders at resolution 1 whatever the screen DPR, and draws the image at the file size', async () => {
    const { engine, sceneGraph, calls } = rig();
    const layers = room();
    const { filename } = await runExportPipeline(engine, sceneGraph, layers, opts);

    expect(filename).toContain('1408x1024');
    expect(calls.rt).toEqual([[1408, 1024, 1]]);
    expect(calls.canvas).toEqual([1408, 1024]);
    // Sized, so an image that ever came back larger is scaled to fit, not cropped.
    expect(calls.drawn).toEqual([[0, 0, 1408, 1024]]);
  });

  it('applies the lighting by default and when asked', async () => {
    const { engine, sceneGraph, calls } = rig();
    const layers = room();
    await runExportPipeline(engine, sceneGraph, layers, opts);
    await runExportPipeline(engine, sceneGraph, layers, { ...opts, lighting: true });

    expect(calls.lighting).toBe(2);
    expect(calls.held).toEqual([{ lit: true }, { lit: true }]);
  });

  it('skips the lighting pass and holds the plain look for an unlit file', async () => {
    const { engine, sceneGraph, calls } = rig();
    await runExportPipeline(engine, sceneGraph, room(), { ...opts, lighting: false });

    expect(calls.lighting).toBe(0);
    expect(calls.held).toEqual([{ lit: false }]);
  });

  it('centres the room in the whole-cell file', async () => {
    const { engine, sceneGraph, calls } = rig();
    const layers = room();
    const b = computeMapWorldBounds(layers);
    await runExportPipeline(engine, sceneGraph, layers, opts);

    const { x, y } = calls.position!;
    const left = b.minX * 128 + x;
    const right = 1408 - (b.maxX * 128 + x);
    const top = b.minY * 128 + y;
    const bottom = 1024 - (b.maxY * 128 + y);
    expect(left).toBeGreaterThan(1);
    expect(left).toBeCloseTo(right, 6);
    expect(top).toBeCloseTo(bottom, 6);
  });

  it('renders the overhead props: their container sits inside the tree the file is drawn from', async () => {
    const { engine } = rig();
    const sceneGraph = buildSceneGraph({
      viewport: () => ({ width: 800, height: 600, dpr: 1 }),
      stage: () => new Container(),
      overlay: () => new Container(),
      ticker: () => ({ add: () => {}, remove: () => {} }),
    } as unknown as RenderEngine);
    const rendered: unknown[] = [];
    const recording = { ...engine, renderToTexture: (c: unknown) => { rendered.push(c); } } as unknown as RenderEngine;

    await runExportPipeline(recording, sceneGraph, room(), { ...opts, lighting: false });

    expect(rendered).toEqual([sceneGraph.worldContainer]);
    let node: Container | null = sceneGraph.overheadContainer;
    while (node && node !== sceneGraph.worldContainer) node = node.parent as Container | null;
    expect(node).toBe(sceneGraph.worldContainer);
  });

  describe('labels and editor marks', () => {
    type Node = { label: string; visible: boolean };
    const node = (label: string, visible = true): Node => ({ label, visible });

    /** A scene whose world holds the zone marks and the tool previews, and a layer with two labels. */
    function labelled() {
      const base = rig();
      room();
      const dl = dungeonLayer();
      const text = (id: string, players?: true) => ({
        id, name: id, childType: 'text' as const, visible: true, text: id, position: { x: 4, y: 4 }, rotation: 0, scale: 1,
        fontSize: 1, color: '#111111', width: 2, height: 1, ...(players ? { players } : {}),
      });
      useStore.getState().addChild(dl.id, text('dm'));
      useStore.getState().addChild(dl.id, text('seen', true));
      const zones = node('zoneOverlay');
      const preview = node('previewContainer');
      const sub = { visible: true, children: [node('label-dm'), node('label-pill-dm'), node('label-seen')] };
      getLayerEntries().set(dl.id, { sublayers: { labels: sub } } as never);
      (base.sceneGraph.worldContainer as unknown as { children: Node[] }).children = [zones, preview];
      const seen: Record<string, boolean>[] = [];
      const engine = {
        ...base.engine,
        renderToTexture: () => {
          seen.push({
            zones: zones.visible,
            preview: preview.visible,
            labels: sub.visible,
            dm: sub.children[0].visible,
            dmPill: sub.children[1].visible,
            seen: sub.children[2].visible,
          });
        },
      } as unknown as RenderEngine;
      return { engine, sceneGraph: base.sceneGraph, layers: useStore.getState().layers, seen, zones, preview, sub };
    }

    afterEach(() => getLayerEntries().clear());

    it('All draws every label; the zone marks and tool previews never reach the file', async () => {
      const r = labelled();
      await runExportPipeline(r.engine, r.sceneGraph, r.layers, { ...opts, lighting: false });
      expect(r.seen).toEqual([{ zones: false, preview: false, labels: true, dm: true, dmPill: true, seen: true }]);
      // Handed back afterwards.
      expect(r.zones.visible && r.preview.visible).toBe(true);
    });

    it('Players hides the DM-only labels and their pills, and puts them back', async () => {
      const r = labelled();
      await runExportPipeline(r.engine, r.sceneGraph, r.layers, { ...opts, lighting: false, labels: 'players' });
      expect(r.seen[0]).toMatchObject({ labels: true, dm: false, dmPill: false, seen: true });
      expect(r.sub.children.every((c) => c.visible)).toBe(true);
    });

    it('None hides the labels sublayer for the render only', async () => {
      const r = labelled();
      await runExportPipeline(r.engine, r.sceneGraph, r.layers, { ...opts, lighting: false, labels: 'none' });
      expect(r.seen[0]).toMatchObject({ labels: false });
      expect(r.sub.visible).toBe(true);
    });
  });
});

describe('computeMapWorldBounds: cave band rock', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    bandSets.clear();
  });

  function bandRoom(setId: string) {
    const dl = dungeonLayer();
    return useStore.getState().layers.map((l) =>
      l.id === dl.id
        ? { ...dl, style: { ...dl.style, wallTextureSetId: setId, wallWidth: 0.5 }, mergedFloor: [[[0, 0], [10, 0], [10, 6], [0, 6]]] }
        : l,
    ) as DungeonLayer[];
  }

  it('reaches BAND_REACH past the floor on a band layer, where rock is laid', () => {
    bandSets.add('GG_Cave_Ink');
    const b = computeMapWorldBounds(bandRoom('GG_Cave_Ink'), null, null);
    expect(b.minX).toBeCloseTo(-BAND_REACH, 6);
    expect(b.minY).toBeCloseTo(-BAND_REACH, 6);
    expect(b.maxX).toBeCloseTo(10 + BAND_REACH, 6);
    expect(b.maxY).toBeCloseTo(6 + BAND_REACH, 6);
  });

  it('keeps the stroke pad alone for an ordinary wall set', () => {
    const b = computeMapWorldBounds(bandRoom('GG_Fieldstone'), null, null);
    expect(b.minX).toBeCloseTo(-0.3, 6);
    expect(b.maxX).toBeCloseTo(10.3, 6);
  });
});
