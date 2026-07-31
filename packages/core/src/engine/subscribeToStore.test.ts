import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Clipper2 is WASM that never loads in unit tests. Stubbed to a counting
// concat so "did the union run?" is answerable — the whole point of #18.
vi.mock('../geometry/Clipper2Engine', () => ({
  clipper2Engine: {
    union: vi.fn((a: [number, number][][], b: [number, number][][]) => [...a, ...b]),
    difference: vi.fn((a: [number, number][][]) => a),
  },
}));

vi.mock('pixi.js', () => ({
  Assets: { load: vi.fn(() => Promise.resolve(null)) },
  Texture: class {},
  TilingSprite: class {},
}));

vi.mock('./floorWallRenderer', () => ({
  rebuildDungeonLayer: vi.fn(),
  redrawDoors: vi.fn(),
  preloadLayerTextures: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('./wallNodeRenderer', () => ({
  preloadWallTextures: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('./renderCache', () => ({ markDirty: vi.fn() }));

vi.mock('./sceneGraph', () => {
  const entry = {
    container: { visible: true, alpha: 1 },
    textureSprite: null,
    sublayers: {
      floor: { visible: true },
      grid: { visible: true },
      hatching: { visible: true },
      walls: { visible: true },
      doors: { visible: true },
    },
  };
  return {
    addLayerToScene: vi.fn(),
    removeLayerFromScene: vi.fn(),
    reorderLayers: vi.fn(),
    getLayerEntries: vi.fn(() => new Map([['*', entry]])),
    getLayerEntry: vi.fn(() => entry),
  };
});

vi.mock('../store/roomSync', () => ({ scheduleRoomSync: vi.fn() }));

vi.mock('../shared/notify', () => ({
  notify: { subtle: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { subscribeToStore, flushLayerDraws } from './subscribeToStore';
import { useStore } from '../store/store';
import { LightManager, extractWallSegments } from './lighting';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { rebuildDungeonLayer, redrawDoors } from './floorWallRenderer';
import { scheduleRoomSync } from '../store/roomSync';
import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';
import type { DungeonLayer } from '../store/types';
import type { DoorChild, LightChild, ShapeChild, WallSegment } from '../shared/types';

function shape(id: string, x: number, y: number, size = 40): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size]]],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number): WallSegment {
  return {
    id,
    points: [[x1, y1], [x2, y2]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    width: 2,
    roughness: 0,
  };
}

function door(id: string, wallId: string, x: number, y: number): DoorChild {
  return {
    id,
    name: id,
    childType: 'door',
    visible: true,
    wallId,
    position: [x, y],
    angle: 0,
    width: 20,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };
}

function light(id: string, x: number, y: number, radius = 200): LightChild {
  return {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius,
    featherRadius: 0,
    intensity: 1,
    falloff: 'linear',
    position: { x, y },
  };
}

const engine = {} as RenderEngine;
const sceneGraph = {
  gridRenderer: { markDirty: vi.fn() },
  backgroundLayer: { addChild: vi.fn(), removeChild: vi.fn() },
} as unknown as SceneGraph;

function dungeon(): DungeonLayer {
  const layer = useStore.getState().layers.find((l) => l.type === 'dungeon');
  if (!layer || layer.type !== 'dungeon') throw new Error('no dungeon layer');
  return layer;
}

/** Seed the active dungeon layer without going through a tool. */
function seed(patch: Partial<DungeonLayer>): string {
  const id = dungeon().id;
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === id);
    if (l && l.type === 'dungeon') Object.assign(l, patch);
  });
  return id;
}

function patchDoor(layerId: string, doorId: string, patch: Partial<DoorChild>): void {
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === layerId);
    if (!l || l.type !== 'dungeon') return;
    const d = l.children.find((c) => c.id === doorId) as DoorChild | undefined;
    if (d) Object.assign(d, patch);
  });
}

describe('subscribeToStore — door state toggles never touch geometry (#18)', () => {
  let unsub: () => void;
  let lightManager: LightManager;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    flushLayerDraws();
    vi.clearAllMocks();
    lightManager = new LightManager();
  });

  afterEach(() => {
    unsub?.();
    // Layer draws are queued for the next frame; drain them here so a pending
    // one cannot land mid-way through the next test.
    flushLayerDraws();
  });

  /**
   * Subscribe and draw the initial pass. Rebuilds are coalesced to a frame, so a
   * test that asserts on them has to say when the frame is.
   */
  function start(): () => void {
    const stop = subscribeToStore(engine, sceneGraph, lightManager);
    flushLayerDraws();
    return stop;
  }

  it('a state-only toggle skips the mergedFloor union and the room resync', () => {
    // Two shapes so the union has real work; a wall + door far from them.
    const layerId = seed({
      children: [shape('s1', 500, 500), shape('s2', 560, 500), door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();

    // fireImmediately did the first union.
    expect(vi.mocked(clipper2Engine.union).mock.calls.length).toBeGreaterThan(0);
    const floorBefore = dungeon().mergedFloor;
    expect(floorBefore).not.toBeNull();

    vi.clearAllMocks();
    patchDoor(layerId, 'd1', { state: 'open' });
    flushLayerDraws();

    // The handler ran, but only the doors sublayer redrew...
    expect(redrawDoors).toHaveBeenCalled();
    // ...no wall-stone re-layout, and nothing geometric moved.
    expect(rebuildDungeonLayer).not.toHaveBeenCalled();
    expect(clipper2Engine.union).not.toHaveBeenCalled();
    expect(clipper2Engine.difference).not.toHaveBeenCalled();
    expect(scheduleRoomSync).not.toHaveBeenCalled();
    // Same array identity, so the wall resolver memo survives too.
    expect(dungeon().mergedFloor).toBe(floorBefore);
  });

  it('a shape edit still rebuilds the union and resyncs rooms', () => {
    const layerId = seed({
      children: [shape('s1', 500, 500), shape('s2', 560, 500), door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    const floorBefore = dungeon().mergedFloor;
    vi.clearAllMocks();

    useStore.setState((s) => {
      const l = s.layers.find((la) => la.id === layerId);
      if (!l || l.type !== 'dungeon') return;
      (l.children[0] as ShapeChild).contours[0][2] = [600, 600];
    });

    expect(clipper2Engine.union).toHaveBeenCalled();
    expect(scheduleRoomSync).toHaveBeenCalled();
    expect(dungeon().mergedFloor).not.toBe(floorBefore);
  });

  it('a wall edit still resyncs rooms without rebuilding the union', () => {
    const layerId = seed({
      children: [shape('s1', 500, 500), shape('s2', 560, 500)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    vi.clearAllMocks();

    useStore.setState((s) => {
      const l = s.layers.find((la) => la.id === layerId);
      if (l && l.type === 'dungeon') l.standaloneWalls[0].wallType = 'terrain';
    });

    expect(scheduleRoomSync).toHaveBeenCalled();
    expect(clipper2Engine.union).not.toHaveBeenCalled();
  });

  it('occlusion and the light polygon do update on a toggle', () => {
    const layerId = seed({
      children: [shape('s1', 500, 500), door('d1', 'w1', 50, 0), light('l1', 50, -30)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();

    lightManager.rebuildIfDirty([dungeon()]);
    const segsClosed = extractWallSegments([dungeon()]).length;
    const polyClosed = lightManager.getOrComputePolygon(light('l1', 50, -30));

    patchDoor(layerId, 'd1', { state: 'open' });

    expect(lightManager.isWallsDirty()).toBe(true);
    expect(lightManager.getDirtyCount()).toBeGreaterThan(0);

    lightManager.rebuildIfDirty([dungeon()]);
    const segsOpen = extractWallSegments([dungeon()]).length;
    const polyOpen = lightManager.getOrComputePolygon(light('l1', 50, -30));

    // Closed door = wall halves + the door itself; open = halves only.
    expect(segsOpen).toBe(segsClosed - 1);
    expect(polyOpen).not.toEqual(polyClosed);
  });

  it('toggling on a dressed map does not regress into a geometry rebuild', () => {
    // ~40 rooms of floor, 60 standalone walls, 25 doors, 12 lights.
    const shapes = Array.from({ length: 40 }, (_, i) =>
      shape(`s${i}`, (i % 8) * 60, Math.floor(i / 8) * 60),
    );
    const walls = Array.from({ length: 60 }, (_, i) =>
      wall(`w${i}`, i * 9, 400, i * 9 + 80, 400),
    );
    const doors = Array.from({ length: 25 }, (_, i) => door(`d${i}`, `w${i}`, i * 9 + 40, 400));
    const lights = Array.from({ length: 12 }, (_, i) => light(`l${i}`, i * 40, 380, 250));

    const layerId = seed({
      children: [...shapes, ...doors, ...lights],
      standaloneWalls: walls,
    });

    unsub = start();
    lightManager.rebuildIfDirty([dungeon()]);
    for (const l of lights) lightManager.getOrComputePolygon(l);

    const samples: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t0 = performance.now();
      patchDoor(layerId, 'd7', { state: i % 2 === 0 ? 'open' : 'closed' });
      // The invalidation the store change queues, drained the way the render
      // loop drains it: resolver + occlusion + every dirty light's sweep.
      lightManager.rebuildIfDirty([dungeon()]);
      for (const l of lights) lightManager.getOrComputePolygon(l);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    // A load-immune tripwire, not the product bar: this runs alongside other
    // suites, where a clean ~17-20ms median drifts past 50ms on contention
    // alone. 150ms still catches the regression it exists for — Clipper2 back
    // on the toggle path was ~280ms. The <50ms product bar is verified by the
    // P7 e2e browser timing row, which also covers the GPU redraw this cannot.
    expect(median).toBeLessThan(150);
  });

  // A door can be dragged now, so its authored position is live data. The
  // signature used to omit it: the commit wrote the store and nothing redrew.
  //
  // Position/width/wallId is door GEOMETRY: withoutDoorGaps (wallNodeRenderer)
  // cuts stone gaps from it, so it still needs the full rebuild. isSecret is
  // door STATE — it changes occlusion and the glyph, not where the stones
  // sit, so it takes the doors-only path instead (this is #22, layered on
  // top of #18's floor/room split above).
  it('a position-only door change still forces the full rebuild (stone gaps depend on it)', () => {
    const layerId = seed({
      children: [shape('s1', 500, 500), shape('s2', 560, 500), door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    const floorBefore = dungeon().mergedFloor;
    vi.clearAllMocks();
    const invalidateAll = vi.spyOn(lightManager, 'invalidateAll');

    patchDoor(layerId, 'd1', { position: [70, 0] });
    flushLayerDraws();

    expect(rebuildDungeonLayer).toHaveBeenCalled();
    expect(redrawDoors).not.toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalled();
    // Neither is floor or wall geometry, so #18 still applies.
    expect(clipper2Engine.union).not.toHaveBeenCalled();
    expect(clipper2Engine.difference).not.toHaveBeenCalled();
    expect(scheduleRoomSync).not.toHaveBeenCalled();
    expect(dungeon().mergedFloor).toBe(floorBefore);
  });

  it('an isSecret-only door change redraws just the doors sublayer and re-lights', () => {
    const layerId = seed({
      children: [shape('s1', 500, 500), shape('s2', 560, 500), door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    const floorBefore = dungeon().mergedFloor;
    vi.clearAllMocks();
    const invalidateAll = vi.spyOn(lightManager, 'invalidateAll');

    patchDoor(layerId, 'd1', { isSecret: true });
    flushLayerDraws();

    expect(redrawDoors).toHaveBeenCalled();
    expect(rebuildDungeonLayer).not.toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalled();
    expect(clipper2Engine.union).not.toHaveBeenCalled();
    expect(clipper2Engine.difference).not.toHaveBeenCalled();
    expect(scheduleRoomSync).not.toHaveBeenCalled();
    expect(dungeon().mergedFloor).toBe(floorBefore);
  });

  it('a style-only door change also skips the rebuild', () => {
    const layerId = seed({
      children: [door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    vi.clearAllMocks();

    patchDoor(layerId, 'd1', { style: 'archway' });
    flushLayerDraws();

    expect(redrawDoors).toHaveBeenCalled();
    expect(rebuildDungeonLayer).not.toHaveBeenCalled();
  });

  // ── W4 smoothness pass ────────────────────────────────────────────────
  // Each of these pins one of the audited fixes, by the thing that breaks if
  // the optimisation is undone.

  it('unions every shape in one Clipper2 call, not one per shape', () => {
    seed({ children: [shape('s1', 0, 0), shape('s2', 20, 0), shape('s3', 40, 0)] });

    unsub = start();

    // Three overlapping shapes used to be two folded unions; the merged output
    // is the same set of rings either way.
    expect(vi.mocked(clipper2Engine.union).mock.calls).toHaveLength(1);
    expect(vi.mocked(clipper2Engine.union).mock.calls[0][0]).toHaveLength(3);
    expect(dungeon().mergedFloor).toHaveLength(3);
  });

  it('a texture-only edit re-renders without re-unioning, re-detecting or re-lighting', () => {
    const layerId = seed({
      children: [shape('s1', 0, 0), shape('s2', 20, 0), light('l1', 10, 10)],
    });

    unsub = start();
    const floorBefore = dungeon().mergedFloor;
    vi.clearAllMocks();
    const invalidateAll = vi.spyOn(lightManager, 'invalidateAll');

    useStore.setState((s) => {
      const l = s.layers.find((la) => la.id === layerId);
      if (!l || l.type !== 'dungeon') return;
      (l.children[0] as ShapeChild).textureTint = '#884422';
    });
    flushLayerDraws();

    // The floor still has to redraw — the tint is what changed.
    expect(rebuildDungeonLayer).toHaveBeenCalled();
    // Nothing under it moved, so none of the expensive passes may run.
    expect(clipper2Engine.union).not.toHaveBeenCalled();
    expect(scheduleRoomSync).not.toHaveBeenCalled();
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(dungeon().mergedFloor).toBe(floorBefore);
  });

  it('several writes before the frame draw once, and a rebuild beats a redraw', () => {
    const layerId = seed({
      children: [shape('s1', 0, 0), door('d1', 'w1', 50, 0)],
      standaloneWalls: [wall('w1', 0, 0, 100, 0)],
    });

    unsub = start();
    vi.clearAllMocks();

    // What a drag delivers between two frames.
    patchDoor(layerId, 'd1', { state: 'open' });
    patchDoor(layerId, 'd1', { position: [60, 0] });
    patchDoor(layerId, 'd1', { position: [70, 0] });
    expect(rebuildDungeonLayer).not.toHaveBeenCalled();

    flushLayerDraws();
    expect(rebuildDungeonLayer).toHaveBeenCalledTimes(1);
    // rebuildDungeonLayer draws the doors too, so the queued redraw is dropped.
    expect(redrawDoors).not.toHaveBeenCalled();
    // The last write is the one drawn.
    const drawn = vi.mocked(rebuildDungeonLayer).mock.calls[0][0] as DungeonLayer;
    const drawnDoor = drawn.children.find((c) => c.id === 'd1') as DoorChild;
    expect(drawnDoor.position).toEqual([70, 0]);
  });

  it('a deleted layer stops holding a geometry key', () => {
    const layerId = seed({ children: [shape('s1', 500, 500), shape('s2', 560, 500)] });

    unsub = start();
    const snapshot = structuredClone(dungeon());

    useStore.setState((s) => {
      s.layers = s.layers.filter((l) => l.id !== layerId);
    });
    vi.clearAllMocks();

    // Same id, same shapes. A key left behind by the delete would read as
    // "unchanged" and skip the union, so the layer would come back floorless.
    useStore.setState((s) => {
      s.layers.push(snapshot);
    });

    expect(clipper2Engine.union).toHaveBeenCalled();
  });
});
