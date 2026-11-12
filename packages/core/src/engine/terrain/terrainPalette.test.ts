// A palette slot whose pack art had not decoded when the palette loaded is loaded again (and
// the painted ground re-baked) once that texture arrives — a reopened map drew painted
// terrain plain white until then.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BufferImageSource, Texture } from 'pixi.js';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const blank = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
const state = { decoded: false };
const subscribers: (() => void)[] = [];
vi.mock('../assetPackInstance', () => ({
  getAssetPackManager: () => ({
    subscribeTextures: (cb: () => void) => {
      subscribers.push(cb);
      return () => subscribers.splice(subscribers.indexOf(cb), 1);
    },
  }),
}));
vi.mock('../../assets/textureLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assets/textureLoader')>()),
  resolveTexture: () => (state.decoded ? art : blank),
  unitTexture: () => ({ texture: state.decoded ? art : blank, cellsWide: 8, cellsHigh: 8 }),
}));

import { TerrainRenderer } from './TerrainRenderer';
import { useStore } from '../../store/store';
import type { RenderEngine } from '../RenderEngine';

const flush = () => new Promise((r) => setTimeout(r, 0));
const tiles = (r: TerrainRenderer) => (r as unknown as { tileRTs: unknown[] }).tileRTs;

function makeRenderer(): TerrainRenderer {
  const engine = { renderToTexture: vi.fn(), renderer: () => ({}) } as unknown as RenderEngine;
  return new TerrainRenderer(engine);
}

describe('terrain palette waits for pack art', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    state.decoded = false;
    subscribers.length = 0;
  });

  it('loads a slot again once its texture is decoded', async () => {
    useStore.getState().setTerrainData({ palette: ['gg-forge:wild_grass_8x8_floor_A', null, null, null, null, null] });
    const r = makeRenderer();
    await flush();
    expect(tiles(r)[0]).toBeNull();

    state.decoded = true;
    for (const cb of subscribers) cb();
    await flush();
    expect(tiles(r)[0]).not.toBeNull();
    r.destroy();
  });

  it('leaves a whole palette alone when other textures land', async () => {
    useStore.getState().setTerrainData({ palette: ['gg-forge:wild_grass_8x8_floor_A', null, null, null, null, null] });
    state.decoded = true;
    const r = makeRenderer();
    await flush();
    const load = vi.spyOn(r, 'loadPalette');
    for (const cb of subscribers) cb();
    await flush();
    expect(load).not.toHaveBeenCalled();
    r.destroy();
  });
});
