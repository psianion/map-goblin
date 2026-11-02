// Attached objects: props a kit places along a path or a plot, laid on draw, laid again on
// every edit of the host, gone with it, and let go of by Detach or by a hand that moves one.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { BufferImageSource, Texture } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const obj = (material: string, gridSize: string, set: string) => ({ type: 'object', material, gridSize, set, tags: ['object'] });
const kit = (set: string, k: Record<string, unknown>) => ({ type: 'kit', material: set, gridSize: '1x1', set, tags: ['path', 'kit'], kit: k });
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          'road-dirt-fill': { type: 'path', material: 'road-dirt-fill', gridSize: '4x1', set: 'road-dirt', tags: [] },
          'dirt-pebbles_1x1_object_A': obj('dirt-pebbles', '1x1', 'GG_Paths_Props'),
          'road-dirt-kit': kit('road-dirt', {
            kind: 'surface',
            fill: 'road-dirt-fill',
            scale: 0.5,
            edge: [{ key: 'dirt-pebbles_1x1_object_A', weight: 1, spacing: 0.6, jitter: 0.3 }],
            objects: [{ key: 'gg-demo:tree_small_1_3x3_object_A', weight: 1, spacing: 5, jitter: 3.14, side: 1 }],
          }),
          'water-fill': { type: 'path', material: 'water-fill', gridSize: '4x4', set: 'water', tags: [] },
          'water-reeds_1x1_object_A': obj('water-reeds', '1x1', 'GG_Paths_Props'),
          'water-lily-pads_1x1_object_A': obj('water-lily-pads', '1x1', 'GG_Paths_Props'),
          'water-kit': kit('water', {
            kind: 'surface',
            fill: 'water-fill',
            objects: [
              { key: 'water-reeds_1x1_object_A', weight: 1, spacing: 2.5, jitter: 0.5, side: 0 },
              { key: 'water-lily-pads_1x1_object_A', weight: 1, spacing: 3, jitter: 3.14, side: -1 },
            ],
          }),
          'cliff-rubble_1x1_object_A': obj('cliff-rubble', '1x1', 'GG_Paths_Props'),
          'cliff-foot-kit': kit('cliff-foot', {
            kind: 'surface',
            scale: 0.5,
            edge: [{ key: 'cliff-rubble_1x1_object_A', weight: 1, spacing: 0.7, jitter: 3.14 }],
            objects: [{ key: 'cliff-rubble_1x1_object_A', weight: 1, spacing: 3, jitter: 3.14, side: 1 }],
          }),
        },
      },
    },
    { packId: 'gg-demo', manifest: { entries: { tree_small_1_3x3_object_A: obj('tree_small_1', '3x3', 'demo-nature') } } },
  ],
  getTexture: () => art,
  getFrame: () => null,
  waitForTexture: vi.fn(() => new Promise(() => {})),
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));

import { setClipperModule } from '../../geometry/Clipper2Engine';
import { pointInPath } from '../../geometry/pathGeometry';
import { createAttachedSync, layAttached, layerUnits } from './attachedObjects';
import { MAX_OVERLAP, unitOverlap } from './pathKitLayout';
import type { AssetChild, PathChild } from '../../shared/types';
import type { DungeonLayer, Layer, ShapeChild } from '../../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const road = (id: string, points: { x: number; y: number }[], over: Partial<PathChild> = {}): PathChild => ({
  id,
  name: id,
  childType: 'path',
  visible: true,
  points,
  closed: false,
  width: 2,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0,
  flip: false,
  edge: 'soft',
  ends: { start: 'cut', end: 'cut', length: 1 },
  sort: 'under',
  ...over,
});

const ring = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const lake = (id: string) => road(id, ring(40, 0, 52, 10), { materialId: 'gg-forge:water', closed: true, fill: true, width: 1 });

const plateau = (id: string): ShapeChild =>
  ({
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 20], [12, 20], [12, 30], [0, 30]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    height: 2,
    edge: 'cliff',
  }) as ShapeChild;

const layerOf = (children: DungeonLayer['children']) =>
  ({ id: 'l1', type: 'dungeon', children, style: { floorColor: '#808080' } }) as unknown as DungeonLayer;

const attachedOf = (layer: Pick<DungeonLayer, 'children'>) =>
  layer.children.filter((c): c is AssetChild => c.childType === 'asset' && !!c.attachedTo);

/** A sync, a layer kept by hand, and a step that applies what the sync writes. */
function harness(children: DungeonLayer['children']) {
  const sync = createAttachedSync();
  let layer = layerOf(children);
  const step = (rev = 0) => {
    const writes = sync([layer as Layer], rev);
    const next = writes?.get('l1');
    if (next) layer = { ...layer, children: next as DungeonLayer['children'] };
    return !!next;
  };
  return {
    step,
    get layer() {
      return layer;
    },
    set: (children: DungeonLayer['children']) => {
      layer = { ...layer, children };
    },
  };
}

describe('layAttached', () => {
  const straight = road('r', [{ x: 0, y: 0 }, { x: 30, y: 0 }]);

  it('lines a road’s verge with its kit’s trees, both sides, none on the road, seeded by the road', () => {
    const layer = layerOf([straight]);
    const laid = layAttached(layer, new Set(['r']), layerUnits(layer));
    expect(laid.length).toBeGreaterThanOrEqual(8);
    for (const a of laid) {
      expect(a.assetId).toBe('gg-demo:tree_small_1_3x3_object_A');
      expect(a.attachedTo).toMatchObject({ kind: 'path', id: 'r', side: 1 });
      expect(a.attachedTo!.t).toBeGreaterThanOrEqual(0);
      expect(a.attachedTo!.t).toBeLessThanOrEqual(1);
      expect(pointInPath(straight, [a.position.x, a.position.y])).toBe(false);
      // Out past the verge: the road's edge is a cell off the centreline, the tree half its 3 cells more.
      if (a.position.x > 0 && a.position.x < 30) expect(Math.abs(a.position.y)).toBeGreaterThan(2.4);
      expect([a.width, a.height]).toEqual([3, 3]);
    }
    expect(laid.some((a) => a.position.y > 0)).toBe(true);
    expect(laid.some((a) => a.position.y < 0)).toBe(true);
    expect(new Set(laid.map((a) => a.id)).size).toBe(laid.length);
    expect(layAttached(layer, new Set(['r']), layerUnits(layer))).toEqual(laid);
  });

  it('never overlaps another object, an edge unit or a prop by more than 20 %', () => {
    const crossing = road('c', [{ x: 15, y: -12 }, { x: 15, y: 12 }]);
    const crate = { x: 6, y: 3, size: 2 };
    const layer = layerOf([straight, crossing, lake('w'), plateau('p')]);
    const units = layerUnits(layer);
    expect(units.length).toBeGreaterThan(50);
    const laid = layAttached(layer, new Set(['r', 'c', 'w', 'p']), [...units, crate]);
    expect(laid.length).toBeGreaterThan(15);
    const discs = laid.map((a) => ({ x: a.position.x, y: a.position.y, size: Math.max(a.width, a.height) }));
    let worst = 0;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) worst = Math.max(worst, unitOverlap(discs[i], discs[j]));
      for (const u of [...units, crate]) worst = Math.max(worst, unitOverlap(discs[i], u));
    }
    expect(worst).toBeLessThanOrEqual(MAX_OVERLAP + 1e-9);
  });

  it('sets reeds on a lake’s shore and lily pads on its water', () => {
    const w = lake('w');
    const laid = layAttached(layerOf([w]), new Set(['w']), []);
    const reeds = laid.filter((a) => a.assetId.includes('reeds'));
    const pads = laid.filter((a) => a.assetId.includes('lily'));
    expect(reeds.length).toBeGreaterThan(5);
    expect(pads.length).toBeGreaterThan(3);
    for (const r of reeds) expect(r.attachedTo!.side).toBe(0);
    for (const p of pads) {
      expect(p.attachedTo!.side).toBe(-1);
      expect(pointInPath(w, [p.position.x, p.position.y])).toBe(true);
    }
  });

  it('scatters rubble past a plateau’s cliff foot, on its low side', () => {
    const laid = layAttached(layerOf([plateau('p')]), new Set(['p']), []);
    expect(laid.length).toBeGreaterThan(5);
    for (const a of laid) {
      expect(a.attachedTo).toMatchObject({ kind: 'shape', id: 'p', side: 1 });
      const { x, y } = a.position;
      const out = Math.hypot(Math.max(0 - x, 0, x - 12), Math.max(20 - y, 0, y - 30));
      // Beyond the foot band (it reaches about 1.05 cells out).
      expect(out).toBeGreaterThan(1.2);
    }
  });
});

describe('createAttachedSync', () => {
  const r = road('r', [{ x: 0, y: 0 }, { x: 30, y: 0 }]);

  it('opens a saved map as it is: no objects laid on load', () => {
    const h = harness([r]);
    expect(h.step()).toBe(false);
    expect(attachedOf(h.layer)).toEqual([]);
  });

  it('lays objects on draw, moves them with the road, removes them with it', () => {
    const h = harness([]);
    h.step();
    h.set([r]);
    expect(h.step()).toBe(true);
    const first = attachedOf(h.layer);
    expect(first.length).toBeGreaterThan(5);
    // Nothing changed: nothing written.
    expect(h.step()).toBe(false);
    // The road moves 4 cells down: its trees move with it, laid as they were.
    h.set([...h.layer.children.filter((c) => c.id !== 'r'), road('r', [{ x: 0, y: 4 }, { x: 30, y: 4 }])]);
    expect(h.step()).toBe(true);
    const moved = attachedOf(h.layer);
    // Laid as they were, give or take the outline's rounding.
    expect(moved).toHaveLength(first.length);
    moved.forEach((a, i) => expect(Math.hypot(a.position.x - first[i].position.x, a.position.y - 4 - first[i].position.y)).toBeLessThan(0.05));
    // Back where it was (an undo): the same trees, where they stood.
    h.set([...h.layer.children.filter((c) => c.id !== 'r'), r]);
    h.step();
    expect(attachedOf(h.layer)).toEqual(first);
    // Deleted: its trees go too.
    h.set(h.layer.children.filter((c) => c.id !== 'r'));
    expect(h.step()).toBe(true);
    expect(attachedOf(h.layer)).toEqual([]);
  });

  it('lets go of a prop a hand moves; an undo of the move keeps it attached', () => {
    const h = harness([]);
    h.step();
    h.set([r]);
    h.step();
    const [tree] = attachedOf(h.layer);
    const nudged = { ...tree, position: { x: tree.position.x + 0.5, y: tree.position.y } };
    h.set(h.layer.children.map((c) => (c.id === tree.id ? nudged : c)));
    expect(h.step()).toBe(true);
    const now = h.layer.children.find((c) => c.id === tree.id) as AssetChild;
    expect(now.attachedTo).toBeUndefined();
    expect(now.position).toEqual(nudged.position);

    // Another: moved and put straight back (undo) before the sync looks again.
    const [other] = attachedOf(h.layer);
    h.set(h.layer.children.map((c) => (c.id === other.id ? { ...other } : c)));
    expect(h.step()).toBe(false);
    expect((h.layer.children.find((c) => c.id === other.id) as AssetChild).attachedTo).toBeDefined();
  });

  it('after Detach, editing the road lays no second tree where a detached one stands', () => {
    const h = harness([]);
    h.step();
    h.set([r]);
    h.step();
    const count = attachedOf(h.layer).length;
    // Detach: every tree a plain prop where it stands.
    h.set(h.layer.children.map((c) => (c.childType === 'asset' ? { ...c, attachedTo: undefined } : c)));
    expect(h.step()).toBe(false);
    // The road edited in place (a new object, same points): nothing laid over the detached trees.
    h.set([...h.layer.children.filter((c) => c.id !== 'r'), { ...r }]);
    h.step();
    expect(attachedOf(h.layer)).toEqual([]);
    expect(h.layer.children.filter((c) => c.childType === 'asset')).toHaveLength(count);
  });

  it('a map loaded later is taken as it stands too', () => {
    const h = harness([]);
    h.step(0);
    h.set([r]);
    // A load moves the rev: the road arrives with the map, nothing is laid.
    expect(h.step(1)).toBe(false);
    expect(attachedOf(h.layer)).toEqual([]);
  });
});
