// Art that lands after the map was drawn: a floor bake that drew a stand-in bakes again when
// the manager reports the texture decoded, however long that took, once the art landing has
// settled, and the rock round a walled cave shows its art in place. The manager here answers a timed wait with null,
// as it does once the wait has given up, so only its texture signal can bring the art in.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { BufferImageSource, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { caveBandPieces } from '../assets/caveWallKit';

const GRASS = 'gg-forge:wild_grass_8x8_floor_A';
const CAVE_FLOOR = 'gg-forge:cave_floor_8x8_floor_A';
const LAYER = 'l1';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });

// The cave band kit as the forge ships it: one entry per piece, in the GG_Cave_Ink set.
const inkEntries: Record<string, unknown> = {};
for (const piece of caveBandPieces()) {
  const cut = piece.key.lastIndexOf('_');
  inkEntries[`ink_${piece.key}_A`] = {
    type: 'object', material: piece.key.slice(0, cut), gridSize: piece.key.slice(cut + 1), pieceType: 'object', variant: 'A',
    frame: { x: 0, y: 0, w: 200, h: 200 }, set: 'GG_Cave_Ink', tags: ['cave'],
  };
}
const INK = Object.keys(inkEntries).map((k) => `gg-forge:${k}`);

const { textures, subs, manager } = vi.hoisted(() => {
  const textures = new Map<string, unknown>();
  const subs = new Set<() => void>();
  const manager = {
    catalogVersion: 1,
    getPackManifests: () => [] as unknown[],
    getTexture: (id: string) => textures.get(id) ?? { width: 1, height: 1 },
    getTextureOrNull: (id: string) => textures.get(id) ?? null,
    getFrame: () => null,
    waitForTexture: () => Promise.resolve(null),
    subscribeTextures: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    subscribeCatalog: () => () => {},
  };
  return { textures, subs, manager };
});
manager.getPackManifests = () => [
  {
    packId: 'gg-forge',
    manifest: {
      entries: {
        cave_floor_8x8_floor_A: { type: 'floor', material: 'cave_floor', gridSize: '8x8', set: 'GG_Cave_Floor', tags: ['cave'] },
        wild_grass_8x8_floor_A: { type: 'floor', material: 'wild_grass', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] },
        ...inkEntries,
      },
    },
  },
];

const host = new Container();
vi.mock('./assetPackInstance', () => ({ getAssetPackManager: () => manager }));
vi.mock('./sceneGraph', () => ({ getLayerEntry: () => ({ sublayers: { materials: host } }) }));

import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from '../store/store';
import type { DungeonLayer, DungeonStyle, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { armLateTextureRebuild } from './floorWallRenderer';
import { drawPiece, type PieceCtx } from './pieceRenderer';
import { drawLayerMaterials } from './material/materialRenderer';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

/** The textures decode, and the manager says so. */
function decode(...ids: string[]): void {
  for (const id of ids) textures.set(id, art);
  for (const cb of [...subs]) cb();
}

/** The textures decode, and the frames after the last of them pass (lateArt.ts). */
async function land(...ids: string[]): Promise<void> {
  decode(...ids);
  await new Promise((r) => setTimeout(r, 100));
}

function epoch(): number {
  return useStore.getState().floorTextureEpochs[LAYER] ?? 0;
}

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const style = { floorColor: '#808080', wallWidth: 1 } as DungeonStyle;

function piece(extra: Partial<ShapeChild>): ShapeChild {
  return {
    id: 'p1', name: 'p1', childType: 'shape', visible: true, shapeType: 'polygon', contours: [square],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ...extra,
  };
}

function layerOf(children: ShapeChild[], mergedFloor: Polygon[] | null = null): DungeonLayer {
  return { id: LAYER, type: 'dungeon', children, standaloneWalls: [], mergedFloor, style } as unknown as DungeonLayer;
}

function draw(shape: ShapeChild): Container {
  const into = new Container();
  const ctx: PieceCtx = { layer: layerOf([shape]), style, floorFallback: undefined, water: [], bleedOf: () => 0, unionFilled: false, soft: new Set() };
  drawPiece(into, shape, ctx);
  return into;
}

/** How many of `kind` `c` holds; with `shown`, only those that show. */
function count(c: Container, kind: typeof Sprite | typeof TilingSprite, shown = false): number {
  let n = 0;
  for (const ch of c.children) {
    if (ch instanceof kind) n += shown && !ch.visible ? 0 : 1;
    else if (ch instanceof Container) n += count(ch, kind, shown);
  }
  return n;
}

beforeEach(() => {
  textures.clear();
  useStore.setState({ floorTextureEpochs: {} });
});

describe('armLateTextureRebuild', () => {
  it('bakes again when the texture lands, after a timed wait would have given up', async () => {
    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    await Promise.resolve();
    expect(epoch()).toBe(0);
    await land('gg-demo:floor_small_8x8_floor_A');
    expect(epoch()).toBe(1);
  });

  it('bakes once however many times a bake repeats on the stand-in or the art lands, and arms again after', async () => {
    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    decode('gg-demo:floor_small_8x8_floor_A');
    await land('gg-demo:floor_small_8x8_floor_A');
    expect(epoch()).toBe(1);
    armLateTextureRebuild(LAYER, 'gg-demo:floor_B');
    await land('gg-demo:floor_B');
    expect(epoch()).toBe(2);
  });

  it('stays quiet while its own texture has not landed', async () => {
    armLateTextureRebuild(LAYER, 'gg-demo:never_ships');
    await land('gg-demo:something_else');
    expect(epoch()).toBe(0);
  });

  it('ignores ids that never arrive late (imported images, data urls)', async () => {
    armLateTextureRebuild(LAYER, 'my-imported-image');
    armLateTextureRebuild(LAYER, 'data:image/png;base64,xyz');
    armLateTextureRebuild(LAYER, 'blob:http://x/abc');
    await land('my-imported-image', 'data:image/png;base64,xyz', 'blob:http://x/abc');
    expect(epoch()).toBe(0);
  });
});

describe('art that lands after the map was drawn', () => {
  it('a ground piece drawn without its texture shows it once the texture lands', async () => {
    const grass = piece({ ground: true, textureId: GRASS, soft: 0.25 });
    expect(count(draw(grass), TilingSprite)).toBe(0);
    await land(GRASS);
    expect(epoch()).toBe(1);
    expect(count(draw(grass), TilingSprite)).toBeGreaterThan(0);
  });

  it('a cave floor drawn without its texture shows it once the texture lands', async () => {
    const cave = piece({ textureId: CAVE_FLOOR, edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } });
    expect(count(draw(cave), TilingSprite)).toBe(0);
    await land(CAVE_FLOOR);
    expect(epoch()).toBe(1);
    expect(count(draw(cave), TilingSprite)).toBeGreaterThan(0);
  });

  it('the rock round a walled cave shows its art in place once the art lands', async () => {
    const layer = layerOf([piece({ textureId: CAVE_FLOOR, edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } })], [square]);
    useStore.setState({ layers: [layer] });
    drawLayerMaterials(layer);
    // Laid, but nothing shows until its art is in.
    const laid = count(host, Sprite);
    expect(laid).toBeGreaterThan(0);
    expect(count(host, Sprite, true)).toBe(0);
    // The waits the first draw armed give up before the art arrives.
    await new Promise((r) => setTimeout(r, 0));
    decode(...INK);
    expect(count(host, Sprite, true)).toBe(laid);
  });
});
