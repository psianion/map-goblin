// Rooms-mode fog over plateaus: a revealed room is clear, but a plateau top whose cliff hides it
// stays under cover until a party token stands at least that high.
import { describe, expect, it } from 'vitest';
import type { Layer, PlateauChild, ShapeChild } from '@dnd/core/src/store/types';
import type { Token } from '@dnd/mechanics/tokens';
import { coveredTops } from './FogRenderer';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeChild> = {}): ShapeChild => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  ...extra,
});

const layer = (children: (ShapeChild | PlateauChild)[]) =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], mergedFloor: null }) as unknown as Layer;

const token = (over: Partial<Token>): Token => ({
  id: 't',
  name: 't',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
  defId: null,
  x: 1.5,
  y: 1.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p-1',
  ...over,
});

function plat(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild {
  return {
    id,
    name: id,
    childType: 'plateau',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    height: 1,
    edge: 'cliff',
    ...extra,
  };
}

const ground = rect('ground', 0, 0, 30, 30);

describe('coveredTops', () => {
  it('covers a +3 cliff top from a party on the ground, and uncovers it once one stands that high', () => {
    const layers = [layer([ground, plat('mesa', 10, 10, 14, 14, { height: 3, edge: 'cliff' })])];
    expect(coveredTops(layers, [token({})], 2)).toHaveLength(1);
    expect(coveredTops(layers, [token({ elevation: 3 })], 2)).toHaveLength(0);
    // A token nobody claimed is not the party's eye.
    expect(coveredTops(layers, [token({ elevation: 3, ownerId: null })], 2)).toHaveLength(1);
  });

  it('covers nothing the threshold or the edge kind says is in plain view', () => {
    expect(coveredTops([layer([ground, plat('ledge', 10, 10, 14, 14, { height: 1, edge: 'cliff' })])], [token({})], 2)).toHaveLength(0);
    expect(coveredTops([layer([ground, plat('hill', 10, 10, 14, 14, { height: 3, edge: 'slope' })])], [token({})], 2)).toHaveLength(0);
    expect(coveredTops([layer([ground, plat('pit', 10, 10, 14, 14, { height: -3, edge: 'cliff' })])], [token({})], 2)).toHaveLength(0);
    expect(
      coveredTops([layer([ground, plat('ledge', 10, 10, 14, 14, { height: 1, edge: 'cliff', sightOverride: 'hide' })])], [token({})], 2),
    ).toHaveLength(1);
  });
});
