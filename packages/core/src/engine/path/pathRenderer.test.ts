// A path as drawn: a piece tagged `soft` is one mesh along the line; any other piece is laid
// as its units, one sprite each, as before.
import { describe, it, expect, vi } from 'vitest';
import { BufferImageSource, Container, Mesh, Sprite, Texture } from 'pixi.js';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 4 * 4), width: 8, height: 4 }) });
const host = new Container();
const piece = (set: string, tags: string[]) => ({ type: 'wall', pieceType: 'path', material: 'trail', gridSize: '2x1', set, tags });
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          trail_soft: piece('GG_Wild_Paths', ['outdoor', 'soft']),
          trail_units: piece('GG_Fieldstone', ['outdoor']),
        },
      },
    },
  ],
  subscribeTextures: () => () => {},
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));
vi.mock('../sceneGraph', () => ({ getLayerEntry: () => ({ sublayers: { paths: host } }) }));
vi.mock('../../assets/textureLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assets/textureLoader')>()),
  resolveTexture: () => art,
  load: () => Promise.resolve(),
}));

import { drawLayerPaths } from './pathRenderer';
import type { DungeonLayer, PathwayChild } from '../../store/types';

const path = (pieceId: string): PathwayChild =>
  ({
    id: 'p1',
    name: 'Path',
    childType: 'pathway',
    visible: true,
    contours: [[[0, 0], [6, 0], [6, 6]]],
    pieceId,
    width: 1,
    smoothness: 0,
    transitionIn: 'fade',
    transitionOut: 'hard',
    blocksLight: false,
  }) as unknown as PathwayChild;
const layerWith = (p: PathwayChild) => ({ id: 'l1', type: 'dungeon', children: [p] }) as unknown as DungeonLayer;

describe('drawing a path', () => {
  it('draws a soft piece as one mesh along the line', () => {
    drawLayerPaths(layerWith(path('gg-forge:trail_soft')));
    const drawn = host.children[0] as Container;
    expect(drawn.children).toHaveLength(1);
    const mesh = drawn.children[0];
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.label).toBe('path-soft');
    expect((mesh as Mesh).geometry.getAttribute('aAlpha')).toBeTruthy();
  });

  it('lays any other piece as its units, as before', () => {
    drawLayerPaths(layerWith(path('gg-forge:trail_units')));
    const drawn = host.children[0] as Container;
    expect(drawn.children.length).toBeGreaterThan(1);
    expect(drawn.children.every((c) => c instanceof Sprite)).toBe(true);
  });
});
