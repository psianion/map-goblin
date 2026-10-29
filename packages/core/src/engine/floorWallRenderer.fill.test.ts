// What one shape's floor is painted with. A texture id from a pack that is no
// longer installed must paint the shape's floor colour (with its own override),
// not a texture fallback the floor colour can never reach.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const textures = new Map<string, { width: number; height: number }>();
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-demo',
      manifest: {
        entries: {
          floor_A: { type: 'floor', material: 'floor_a', gridSize: '1x1', tags: [] },
          floor_B: { type: 'floor', material: 'floor_b', gridSize: '1x1', tags: [] },
        },
      },
    },
  ],
  getTexture: (id: string) => textures.get(id) ?? { width: 1, height: 1 },
  getFrame: () => null,
  waitForTexture: vi.fn(() => new Promise(() => {})),
};
vi.mock('./assetPackInstance', () => ({ getAssetPackManager: () => manager }));

import { shapeFloorFill } from './floorWallRenderer';
import { isMissingTexture, hasLiveTexture } from '../assets/packCatalog';
import type { DungeonStyle, ShapeChild } from '../store/types';

const style = { floorColor: '#b8ac92', wallColor: '#000000', wallWidth: 0.5, lineWidth: 0.04 } as DungeonStyle;

function shape(patch: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id: 's1',
    name: 'Room',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...patch,
  } as ShapeChild;
}

beforeEach(() => {
  textures.clear();
});

describe('isMissingTexture', () => {
  it('flags a pack id no installed pack lists, and nothing else', () => {
    expect(isMissingTexture('dungeon-classic:floor_stone_01')).toBe(true);
    expect(isMissingTexture('gg-demo:floor_A')).toBe(false);
    expect(isMissingTexture('floor_A')).toBe(false); // bare id qualifies through the pack
    expect(isMissingTexture('my-imported-image')).toBe(false);
    expect(isMissingTexture('data:image/png;base64,xyz')).toBe(false);
    expect(isMissingTexture(undefined)).toBe(false);
    expect(hasLiveTexture('dungeon-classic:floor_stone_01')).toBe(false);
    expect(hasLiveTexture('gg-demo:floor_A')).toBe(true);
    expect(hasLiveTexture('')).toBe(false);
  });
});

describe('shapeFloorFill', () => {
  it('an untextured shape paints the layer floor colour, or its own override', () => {
    expect(shapeFloorFill(shape(), style)).toEqual({ kind: 'solid', color: 0xb8ac92 });
    expect(shapeFloorFill(shape({ styleOverrides: { floorColor: '#ff0000' } }), style)).toEqual({
      kind: 'solid',
      color: 0xff0000,
    });
  });

  it('a retired pack texture counts as untextured and takes the floor colour override', () => {
    const fill = shapeFloorFill(
      shape({ textureId: 'dungeon-classic:floor_stone_01', textureTint: '#ffffff', styleOverrides: { floorColor: '#ff0000' } }),
      style,
    );
    // No tint stand-in and no wait armed: this art is never coming.
    expect(fill).toEqual({ kind: 'solid', color: 0xff0000 });
  });

  it('a known texture that has not loaded stands in with its tint, or the floor colour when white', () => {
    expect(shapeFloorFill(shape({ textureId: 'gg-demo:floor_A', textureTint: '#884422' }), style)).toEqual({
      kind: 'solid',
      color: 0x884422,
      waitFor: 'gg-demo:floor_A',
    });
    expect(shapeFloorFill(shape({ textureId: 'gg-demo:floor_A' }), style)).toEqual({
      kind: 'solid',
      color: 0xb8ac92,
      waitFor: 'gg-demo:floor_A',
    });
  });

  it('a loaded texture paints the texture', () => {
    textures.set('gg-demo:floor_B', { width: 200, height: 200 });
    const fill = shapeFloorFill(shape({ textureId: 'gg-demo:floor_B' }), style);
    expect(fill.kind).toBe('texture');
  });

  it("an untextured shape paints its level's floor texture when one is handed down; its own texture still wins", () => {
    textures.set('gg-demo:floor_B', { width: 200, height: 200 });
    expect(shapeFloorFill(shape(), style, 'gg-demo:floor_B').kind).toBe('texture');
    expect(shapeFloorFill(shape(), style, 'gg-demo:floor_A')).toEqual({ kind: 'solid', color: 0xb8ac92, waitFor: 'gg-demo:floor_A' });
    expect(shapeFloorFill(shape({ textureId: 'gg-demo:floor_A' }), style, 'gg-demo:floor_B')).toMatchObject({ waitFor: 'gg-demo:floor_A' });
  });
});
