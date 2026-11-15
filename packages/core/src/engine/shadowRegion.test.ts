// Shadows by region: the sun and moon reach the ground of an Outdoor level except the rooms that
// are not Outdoor, and on any other level only the rooms that are. Walls and props both follow.
// Clipper2 is real here (the clip is the point); PixiJS is a recorder.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    children: MockContainer[] = [];
    label = '';
    visible = true;
    destroyed = false;
    blendMode = 'normal';
    mask: unknown = null;
    filters: unknown[] = [];
    parent: MockContainer | null = null;
    worldTransform = { a: 20, b: 0 };
    addChild(c: MockContainer): MockContainer {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    removeChildren(): MockContainer[] {
      return this.children.splice(0);
    }
    removeChild(c: MockContainer): void {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class MockGraphics extends MockContainer {
    /** Every polygon since the last `clear`, as flat coordinates. */
    polys: number[][] = [];
    clear(): this {
      this.polys = [];
      return this;
    }
    poly(points: number[]): this {
      this.polys.push(points);
      return this;
    }
    rect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
  }
  class MockSprite extends MockContainer {
    anchor = { set: (): void => {} };
    position = { set: (): void => {} };
    scale = { set: (): void => {} };
    skew = { x: 0 };
    alpha = 1;
    tint = 0;
    texture: unknown = { width: 10, height: 10 };
  }
  class MockBlurFilter {
    strength = 0;
    resolution = 1;
  }
  return { Container: MockContainer, Graphics: MockGraphics, Sprite: MockSprite, BlurFilter: MockBlurFilter };
});
vi.mock('./sceneGraph', () => ({ getLayerEntry: vi.fn() }));

import { Container, Sprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { syncPropShadows, updateShadows } from './shadowPass';
import { setTableRoomPlaces, setTableWorld } from './worldOverride';
import { sunAt, type Environment, type MapEnvironment } from '../shared/world';
import { skyFrame } from '../shared/sky';
import { pointInRing } from '../shared/roomUtils';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import type { AssetChild, DungeonLayer } from '../store/types';
import type { Room } from '../shared/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const TERRAIN = { palette: [], bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 } };
const ROOM_FACE: [number, number][] = [[10, 10], [20, 10], [20, 20], [10, 20]];
/** A wall standing inside the room, and one in the open yard. */
const INSIDE: [number, number][] = [[12, 15], [18, 15]];
const OUTSIDE: [number, number][] = [[26, 30], [34, 30]];

const wall = (id: string, points: [number, number][]) => ({
  id,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#26221c',
  width: 0.5,
  roughness: 0,
});

let nextId = 0;
const room = (place: Environment): Room => ({ id: 'room', name: 'room', anchor: [15, 15], face: ROOM_FACE, look: { place } });
const layerOf = (walls: [number, number][][], rooms: Room[]): DungeonLayer =>
  ({
    id: `region-${++nextId}`,
    type: 'dungeon',
    children: [],
    mergedFloor: null,
    rooms,
    standaloneWalls: walls.map((w, i) => wall(`w${i}`, w)),
  }) as unknown as DungeonLayer;

interface Recorder {
  label: string;
  polys: number[][];
  children: Recorder[];
  visible: boolean;
}

describe('shadows by region', () => {
  let shadows: InstanceType<typeof Container>;

  /** Put the map, its layer and the sky in place, then run the pass once. */
  const draw = (place: Environment, layer: DungeonLayer): Recorder => {
    const map: MapEnvironment = { environment: place, naturalLight: true, orientation: 0 };
    useStore.setState((s) => {
      s.mapSettings.environment = place;
      s.mapSettings.naturalLight = true;
      s.mapSettings.terrain = TERRAIN;
      s.mapSettings.orientation = 0;
      s.layers = [layer];
    });
    updateShadows([layer], 1, skyFrame({ ...map, time: 'day' }));
    return shadows.children.filter((c) => c.label === 'wallShadows').at(-1) as unknown as Recorder;
  };
  const insideRoom = (r: Recorder): boolean =>
    r.polys.some((p) => {
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i]!;
        const y = p[i + 1]!;
        // Strictly inside, clear of Clipper's rounding on the face edge.
        if (x > 10.05 && x < 19.95 && y > 10.05 && y < 19.95 && pointInRing(x, y, ROOM_FACE)) return true;
      }
      return false;
    });

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const container = new Container();
    shadows = new Container();
    container.addChild(shadows);
    vi.mocked(getLayerEntry).mockReturnValue({ container, sublayers: { shadows } } as never);
  });
  afterEach(() => {
    setTableWorld(null);
    setTableRoomPlaces(null);
  });

  it('casts a wall shadow on an Outdoor map where nothing is Underground', () => {
    const drawn = draw('outdoor', layerOf([INSIDE, OUTSIDE], []));
    expect(drawn.polys.length).toBeGreaterThan(0);
    expect(insideRoom(drawn)).toBe(true);
  });

  it('draws no wall shadow inside an Underground room on an Outdoor map, and keeps the yard’s', () => {
    const drawn = draw('outdoor', layerOf([INSIDE, OUTSIDE], [room('underground')]));
    expect(drawn.polys.length).toBeGreaterThan(0);
    expect(insideRoom(drawn)).toBe(false);
  });

  it('draws no wall shadow inside an Indoor room on an Outdoor map either', () => {
    expect(insideRoom(draw('outdoor', layerOf([INSIDE, OUTSIDE], [room('indoor')])))).toBe(false);
  });

  it('casts nothing from a wall wholly inside an Underground room', () => {
    expect(draw('outdoor', layerOf([INSIDE], [room('underground')])).polys).toEqual([]);
  });

  it('casts shadows inside an Outdoor room on an Underground map, and only there', () => {
    const drawn = draw('underground', layerOf([INSIDE, OUTSIDE], [room('outdoor')]));
    expect(insideRoom(drawn)).toBe(true);
    // Everything drawn lies within the room's face: the yard wall's shadow is gone.
    for (const p of drawn.polys) {
      for (let i = 0; i < p.length; i += 2) {
        expect(p[i]!).toBeGreaterThanOrEqual(9.95);
        expect(p[i]!).toBeLessThanOrEqual(20.05);
        expect(p[i + 1]!).toBeGreaterThanOrEqual(9.95);
        expect(p[i + 1]!).toBeLessThanOrEqual(20.05);
      }
    }
  });

  it('casts nothing on an Underground map with no Outdoor room', () => {
    expect(draw('underground', layerOf([INSIDE, OUTSIDE], [])).polys).toEqual([]);
    expect(draw('indoor', layerOf([INSIDE, OUTSIDE], [room('indoor')])).polys).toEqual([]);
  });

  it('follows the table’s live room places, both ways', () => {
    const layer = layerOf([INSIDE], [room('underground')]);
    expect(draw('outdoor', layer).polys).toEqual([]);
    // The DM flips the room to Outdoor for this scene: its shadows come back.
    setTableRoomPlaces({ room: 'outdoor' });
    updateShadows([layer], 1, skyFrame({ environment: 'outdoor', naturalLight: true, orientation: 0, time: 'day' }));
    const drawn = shadows.children.filter((c) => c.label === 'wallShadows').at(-1) as unknown as Recorder;
    expect(insideRoom(drawn)).toBe(true);
    // And an Outdoor room flipped Underground loses them.
    const open = layerOf([INSIDE], [room('outdoor')]);
    setTableRoomPlaces({ room: 'underground' });
    expect(draw('outdoor', open).polys).toEqual([]);
  });

  it('casts on a non-Outdoor map whenever natural light is on (sunAt)', () => {
    for (const environment of ['indoor', 'underground'] as const) {
      const sun = sunAt(720, { environment, naturalLight: true }, 'full-moon');
      expect(sun.kind, environment).toBe('sun');
      expect(sun.intensity, environment).toBeGreaterThan(0);
      expect(sunAt(720, { environment, naturalLight: false }, 'full-moon').kind, environment).toBeNull();
    }
  });
});

describe('prop shadows by region', () => {
  let shadows: InstanceType<typeof Container>;

  const prop = (id: string, x: number, y: number): { sprite: InstanceType<typeof Sprite>; obj: AssetChild } => ({
    sprite: new Sprite(),
    obj: { id, position: { x, y }, width: 1, height: 1, scale: 1, visible: true } as unknown as AssetChild,
  });
  const shadowOf = (id: string): Recorder => shadows.children.find((c) => c.label === `prop-shadow-${id}`) as unknown as Recorder;

  const stand = (place: Environment, rooms: Room[], props: ReturnType<typeof prop>[]) => {
    const layer = layerOf([], rooms);
    useStore.setState((s) => {
      s.mapSettings.environment = place;
      s.mapSettings.naturalLight = true;
      s.mapSettings.terrain = TERRAIN;
      s.layers = [layer];
    });
    updateShadows([layer], 1, skyFrame({ environment: place, naturalLight: true, orientation: 0, time: 'day' }));
    syncPropShadows(layer.id, props);
    return layer;
  };

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const container = new Container();
    shadows = new Container();
    container.addChild(shadows);
    vi.mocked(getLayerEntry).mockReturnValue({ container, sublayers: { shadows } } as never);
  });
  afterEach(() => setTableRoomPlaces(null));

  it('casts nothing for a prop standing in an Underground room on an Outdoor map', () => {
    stand('outdoor', [room('underground')], [prop('in', 15, 14.5), prop('out', 30, 14.5)]);
    expect(shadowOf('in').visible).toBe(false);
    expect(shadowOf('out').visible).toBe(true);
  });

  it('casts for a prop in an Outdoor room on an Underground map, and not for one outside', () => {
    stand('underground', [room('outdoor')], [prop('in', 15, 14.5), prop('out', 30, 14.5)]);
    expect(shadowOf('in').visible).toBe(true);
    expect(shadowOf('out').visible).toBe(false);
  });

  it('judges the prop by its foot, not its centre', () => {
    // Centre just outside the room's top edge, foot (centre + half its height) inside it.
    stand('outdoor', [room('underground')], [prop('edge', 15, 9.7)]);
    expect(shadowOf('edge').visible).toBe(false);
  });
});
