import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import {
  boxesByFootprint,
  getChildBounds,
  getChildFootprint,
  hitTestChildren,
  hitTestWalls,
  pickAllLayers,
  pickAt,
  pickStackAt,
  pickStackAtPoint,
  setRoomPicking,
} from './hitTest';
import { useStore } from '../store/store';
import { migrateToLatest } from '../store/migration';
import { refreshRooms } from '../store/roomRefresh';
import { SelectTool } from './tools/SelectTool';
import type { RenderEngine } from './RenderEngine';
import type { AnyChild, DungeonLayer, SerializedMapData } from '../store/types';
import type { AssetChild, ShapeChild, WallSegment, WaterChild, ZoneChild } from '../shared/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
HTMLCanvasElement.prototype.getContext = (() =>
  new Proxy({}, { get: () => () => ({ width: 0, height: 0 }), set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

const water = (id: string, outer: [number, number][], hole?: [number, number][]): WaterChild =>
  ({ id, name: id, childType: 'water', visible: true, opacity: 1, contours: hole ? [outer, hole] : [outer] }) as unknown as WaterChild;
const zone = (id: string, shape: ZoneChild['shape']): ZoneChild => ({ id, name: id, childType: 'zone', visible: true, shape });
const floor = (id: string): ShapeChild =>
  ({ id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [[[0, 0], [10, 0], [10, 10], [0, 10]]] }) as unknown as ShapeChild;
const asset = (id: string, x: number, y: number, extra: Partial<AssetChild> = {}): AssetChild =>
  ({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y }, rotation: 0,
    scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  }) as AssetChild;
const wallAt = (id: string, y: number, extra: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points: [[0, y], [10, y]], wallType: 'normal', direction: 'both', color: '#000', width: 0.3, roughness: 0, ...extra }) as WallSegment;

const dungeon = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const layers = () => useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');

describe('hit testing every kind', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    setRoomPicking(false);
  });
  afterEach(() => setRoomPicking(false));

  it('picks water inside its outer ring', () => {
    expect(hitTestChildren([water('w', [[0, 0], [4, 0], [4, 4], [0, 4]])], [2, 2])?.id).toBe('w');
  });

  it('does not pick water through its holes', () => {
    const w = water('w', [[0, 0], [6, 0], [6, 6], [0, 6]], [[2, 2], [4, 2], [4, 4], [2, 4]]);
    expect(hitTestChildren([w], [3, 3])).toBeNull();
    expect(hitTestChildren([w], [1, 1])?.id).toBe('w');
  });

  it('picks a circle zone within its radius only', () => {
    const z = zone('z', { kind: 'circle', position: { x: 5, y: 5 }, radius: 2 });
    expect(hitTestChildren([z], [6, 6])?.id).toBe('z');
    expect(hitTestChildren([z], [8, 8])).toBeNull();
  });

  it('picks a rect zone inside it', () => {
    const z = zone('z', { kind: 'rect', x: 1, y: 1, width: 3, height: 2 });
    expect(hitTestChildren([z], [2, 2])?.id).toBe('z');
    expect(hitTestChildren([z], [5, 2])).toBeNull();
  });

  it('picks a point zone within 0.35 cell, in screen terms at any zoom', () => {
    const z = zone('z', { kind: 'point', position: { x: 5, y: 5 } });
    expect(hitTestChildren([z], [5.3, 5], undefined, { zoom: 1 })?.id).toBe('z');
    expect(hitTestChildren([z], [5.5, 5], undefined, { zoom: 1 })).toBeNull();
  });

  it('a zone over a floor wins the click', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, floor('f'));
    useStore.getState().addChild(l.id, zone('z', { kind: 'rect', x: 1, y: 1, width: 3, height: 3 }));
    expect(pickAllLayers(layers(), [2, 2])?.id).toBe('z');
  });

  it('a prop over a zone still wins', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, zone('z', { kind: 'rect', x: 1, y: 1, width: 3, height: 3 }));
    useStore.getState().addChild(l.id, asset('p', 2, 2));
    expect(pickAllLayers(layers(), [2, 2])?.id).toBe('p');
  });

  it('lists the whole stack under a point, topmost first', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, floor('f'));
    useStore.getState().addWall(l.id, wallAt('w', 2));
    useStore.getState().addChild(l.id, asset('p', 2, 2));
    expect(pickStackAt(layers(), [2, 2]).map((h) => h.id)).toEqual(['p', 'w', 'f']);
    expect(pickAllLayers(layers(), [2, 2])?.id).toBe('p');
  });

  it('flags a locked object on the hit and passes over it when not asked for', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, floor('f'));
    useStore.getState().addChild(l.id, asset('p', 2, 2, { locked: true }));
    expect(pickAllLayers(layers(), [2, 2])?.id).toBe('f');
    const hit = pickAllLayers(layers(), [2, 2], { includeLockedObjects: true });
    expect(hit?.id).toBe('p');
    expect(hit?.locked).toBe(true);
  });

  it('a locked layer stays click-through, objects and all', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, asset('p', 2, 2));
    useStore.getState().updateLayer(l.id, { locked: true });
    expect(pickAllLayers(layers(), [2, 2], { includeLockedObjects: true })).toBeNull();
  });

  it('a hidden wall never answers', () => {
    const l = { ...dungeon(), standaloneWalls: [wallAt('w', 2, { visible: false })] } as DungeonLayer;
    expect(hitTestWalls(l, [5, 2])).toBeNull();
  });

  it('a hidden child never answers', () => {
    expect(hitTestChildren([{ ...asset('p', 2, 2), visible: false }], [2, 2])).toBeNull();
  });

  it('only the level on show answers', () => {
    useStore.getState().addLevel({ id: 'up', name: 'Up' });
    const upper = { ...structuredClone(dungeon()), id: 'upper', name: 'Upper', levelId: 'up', children: [asset('high', 2, 2)], standaloneWalls: [] };
    useStore.getState().addLayer(upper as DungeonLayer);
    useStore.getState().addChild(dungeon().id, asset('low', 2, 2));
    expect(pickStackAt(layers(), [2, 2]).map((h) => h.id)).toEqual(['low']);
  });

  it('pickAt is the shared pick: same answer as pickAllLayers with locked objects included', () => {
    const l = dungeon();
    useStore.getState().addChild(l.id, floor('f'));
    useStore.getState().addChild(l.id, asset('p', 2, 2, { locked: true }));
    expect(pickAt([2, 2], { zoom: 20 })?.id).toBe('p');
  });

  it('a light’s footprint is its marker square; other kinds keep their bounds', () => {
    const lamp = { id: 'l', name: 'l', childType: 'light', visible: true, radius: 6, position: { x: 4, y: 7 } } as unknown as AnyChild;
    expect(getChildFootprint(lamp)).toEqual({ x: 3.5, y: 6.5, width: 1, height: 1 });
    expect(getChildBounds(lamp)).toEqual({ x: -2, y: 1, width: 12, height: 12 });
    expect(getChildFootprint(asset('p', 2, 2))).toEqual(getChildBounds(asset('p', 2, 2)));
  });

  it('a mixed selection boxes its lights by their marker; lights alone keep their radius', () => {
    const lamp = { id: 'l', name: 'l', childType: 'light', visible: true, radius: 6, position: { x: 4, y: 7 } } as unknown as AnyChild;
    expect(boxesByFootprint([lamp])).toBe(false);
    expect(boxesByFootprint([lamp, { ...lamp, id: 'm' } as AnyChild])).toBe(false);
    expect(boxesByFootprint([lamp, asset('p', 2, 2)])).toBe(true);
    expect(boxesByFootprint([lamp], 1)).toBe(true);
  });
});

describe('the stack under a point', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    setRoomPicking(false);
  });
  afterEach(() => setRoomPicking(false));
  const l = () => dungeon();

  it('water over a floor answers before the floor', () => {
    useStore.getState().addChild(l().id, floor('f'));
    useStore.getState().addChild(l().id, water('w', [[1, 1], [5, 1], [5, 5], [1, 5]]));
    expect(pickStackAt(layers(), [2, 2]).map((h) => h.id)).toEqual(['w', 'f']);
  });

  it('a hidden water body never answers', () => {
    useStore.getState().addChild(l().id, { ...water('w', [[1, 1], [5, 1], [5, 5], [1, 5]]), visible: false });
    expect(pickStackAt(layers(), [2, 2])).toEqual([]);
  });

  it('rooms sit between the walls and the floors, where rooms pick', () => {
    setRoomPicking(true);
    useStore.getState().addChild(l().id, floor('f'));
    useStore.setState((s) => {
      (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).rooms = [{ id: 'r', name: 'Hall', anchor: [2, 2], face: [[0, 0], [6, 0], [6, 6], [0, 6]] }];
    });
    expect(pickStackAt(layers(), [2, 2]).map((h) => h.id)).toEqual(['r', 'f']);
  });

  it('water in a room answers before the room; a zone inside a room answers by its outline only', () => {
    setRoomPicking(true);
    useStore.getState().addChild(l().id, floor('f'));
    useStore.getState().addChild(l().id, water('w', [[1, 1], [3, 1], [3, 3], [1, 3]]));
    useStore.getState().addChild(l().id, zone('z', { kind: 'circle', position: { x: 7, y: 7 }, radius: 2 }));
    useStore.setState((s) => {
      (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).rooms = [{ id: 'r', name: 'Hall', anchor: [5, 5], face: [[0, 0], [10, 0], [10, 10], [0, 10]] }];
    });
    expect(pickAllLayers(layers(), [2, 2], { zoom: 50 })?.id).toBe('w');
    // Inside the circle, away from its line: the room; on the line: the zone.
    expect(pickAllLayers(layers(), [7.5, 7], { zoom: 50 })?.id).toBe('r');
    expect(pickAllLayers(layers(), [9, 7], { zoom: 50 })?.id).toBe('z');
    // The stack still lists the zone under the room.
    expect(pickStackAt(layers(), [7.5, 7], { zoom: 50 }).map((h) => h.id)).toEqual(['r', 'z', 'f']);
  });

  it('overhead props answer first, from any layer', () => {
    useStore.getState().addChild(l().id, asset('low', 2, 2));
    useStore.getState().addChild(l().id, asset('canopy', 2, 2, { overhead: true, width: 3, height: 3 }));
    expect(pickStackAt(layers(), [2, 2]).map((h) => h.id)).toEqual(['canopy', 'low']);
  });

  it('looking under overhead props leaves them out', () => {
    useStore.getState().addChild(l().id, asset('canopy', 2, 2, { overhead: true }));
    useStore.getState().setSeeUnderOverhead(true);
    expect(pickStackAt(layers(), [2, 2])).toEqual([]);
  });

  it('a wall locked on its own answers flagged, only when asked', () => {
    useStore.getState().addWall(l().id, wallAt('w', 2, { locked: true }));
    expect(pickAllLayers(layers(), [5, 2])).toBeNull();
    const hit = pickAllLayers(layers(), [5, 2], { includeLockedObjects: true });
    expect(hit?.kind).toBe('wall');
    expect(hit?.locked).toBe(true);
  });

  it('the nearest of two walls comes first in the stack', () => {
    useStore.getState().addWall(l().id, wallAt('a', 2));
    useStore.getState().addWall(l().id, wallAt('b', 2.2));
    expect(pickStackAt(layers(), [5, 2.15]).map((h) => h.id)).toEqual(['b', 'a']);
  });

  it('lists each object once', () => {
    useStore.getState().addChild(l().id, asset('p', 2, 2, { overhead: true }));
    const ids = pickStackAt(layers(), [2, 2]).map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a point zone answers at the same world distance whatever the zoom', () => {
    const z = zone('z', { kind: 'point', position: { x: 5, y: 5 } });
    expect(hitTestChildren([z], [5.3, 5], undefined, { zoom: 80 })?.id).toBe('z');
    expect(hitTestChildren([z], [5.4, 5], undefined, { zoom: 80 })).toBeNull();
  });
});

describe('pick parity on the goblin warren', () => {
  const ZOOM = 24;
  const engine = (): RenderEngine => {
    const overlay = new Container();
    return {
      overlay: () => overlay,
      canvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) as unknown as HTMLCanvasElement,
      stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
      worldToScreen: (x: number, y: number) => ({ x: x * ZOOM, y: y * ZOOM }),
      screenToWorld: (x: number, y: number) => ({ x: x / ZOOM, y: y / ZOOM }),
    } as unknown as RenderEngine;
  };

  it('left click, hover, right click and double-click resolve the same object at 300 random points', async () => {
    const { readFileSync } = await import('node:fs' as string);
    const { resolve } = await import('node:path' as string);
    const path = resolve(process.cwd(), '../..', 'session/testdata/goblin-warren.mapbuilder');
    useStore.getState().loadFromFile(migrateToLatest(JSON.parse(readFileSync(path, 'utf8'))) as SerializedMapData);
    setRoomPicking(true);
    const tool = new SelectTool(engine());
    // A seeded walk, so a failure names the same point every run.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const l = dungeon();
    const xs = l.children.flatMap((c: AnyChild) => ('position' in c && !Array.isArray(c.position) ? [c.position.x] : []));
    const ys = l.children.flatMap((c: AnyChild) => ('position' in c && !Array.isArray(c.position) ? [c.position.y] : []));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let agree = 0;
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const x = x0 + rand() * (x1 - x0);
      const y = y0 + rand() * (y1 - y0);
      const ev = { clientX: x * ZOOM, clientY: y * ZOOM, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false } as PointerEvent;
      // Snapped the way the grid would, so a left press that picked by the snapped point would disagree.
      const snapped = { x: Math.round(x), y: Math.round(y) };
      useStore.getState().setSelectedIds([]);
      tool.cancel();
      tool.onPointerMove(snapped, ev);
      const hover = useStore.getState().selection.hoveredId;
      tool.onPointerDown(snapped, ev);
      tool.onPointerUp(snapped, ev);
      const picked = useStore.getState().selection.selectedIds;
      tool.cancel();
      const shared = pickAt([x, y], { zoom: ZOOM })?.id ?? null;
      // A click on a grouped child takes the group; the child it landed on is in it.
      const leftAgrees = shared === null ? picked.length === 0 : picked.includes(shared);
      if (shared) hits++;
      if (leftAgrees && hover === shared) agree++;
    }
    console.log(`[metric] pick parity on the warren: ${agree}/300 points agree across click, hover, right-click and double-click (${hits} on an object)`);
    expect(agree).toBe(300);
    expect(hits).toBeGreaterThan(100);
  });
});

describe('the stack at a drawn wall on the goblin warren', () => {
  afterEach(() => setRoomPicking(false));

  it('lists the wall, then the rooms it divides, then the floor, even where the wall stands in rock', async () => {
    const { readFileSync } = await import('node:fs' as string);
    const { resolve } = await import('node:path' as string);
    const path = resolve(process.cwd(), '../..', 'session/testdata/goblin-warren.mapbuilder');
    useStore.getState().loadFromFile(migrateToLatest(JSON.parse(readFileSync(path, 'utf8'))) as SerializedMapData);
    refreshRooms();
    setRoomPicking(true);
    // The Chief Door's wall, near its end: past the doorway, in the rock.
    const w = dungeon().standaloneWalls.find((x) => x.id === 'wall-005')!;
    const [a, b] = w.points;
    const p: [number, number] = [a[0] + (b[0] - a[0]) * 0.1, a[1] + (b[1] - a[1]) * 0.1];
    const kinds = pickStackAtPoint(p, { zoom: 24 }).map((h) => (h.kind === 'child' ? h.child.childType : h.kind));
    expect(kinds[0]).toBe('wall');
    expect(kinds.indexOf('room')).toBeGreaterThan(0);
    expect(kinds.indexOf('shape')).toBeGreaterThan(kinds.lastIndexOf('room'));
    expect(kinds.filter((k) => k === 'room')).toHaveLength(2);
  });
});
