// A prop the pack marks as blocking on a round footprint (a rock pillar): it blocks light, sight
// and movement round a ring of its footprint, not its square frame. Other props are as before.
import { afterEach, describe, expect, it } from 'vitest';
import { propEdges } from './propOcclusion';
import type { AssetChild } from './types';
import type { DungeonLayer } from '../store/types';
import { extractMoveSegments } from '../engine/lighting/raycaster';
import { blockingFields } from '../engine/tools/StampScatterTool';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';

const prop = (extra: Partial<AssetChild>): AssetChild =>
  ({ id: 'p', name: 'p', childType: 'asset', visible: true, objectType: 'asset', assetId: 'x', position: { x: 5, y: 5 }, rotation: 0, scale: 2, width: 2, height: 2, tint: '#fff', flipX: false, flipY: false, ...extra }) as AssetChild;

const layer = (children: AssetChild[]): DungeonLayer =>
  ({ id: 'l', name: 'l', type: 'dungeon', visible: true, children, standaloneWalls: [], style: { wallWidth: 0.5 }, mergedFloor: [] }) as unknown as DungeonLayer;

afterEach(() => resetAssetPackManager());

describe('a prop with a round footprint', () => {
  it('blocks along a ring of its footprint, at its size', () => {
    const edges = propEdges(prop({ blocksLight: true, footprintRadius: 0.6 }));
    expect(edges.length).toBeGreaterThanOrEqual(8);
    for (const e of edges) expect(Math.hypot(e.x1 - 5, e.y1 - 5)).toBeCloseTo(1.2, 5);
  });

  it('keeps a square prop to its four edges', () => {
    expect(propEdges(prop({ blocksLight: true }))).toHaveLength(4);
  });

  it('stops movement where it blocks; a square blocking prop still does not', () => {
    expect(extractMoveSegments([layer([prop({ blocksLight: true, footprintRadius: 0.6 })])]).length).toBeGreaterThanOrEqual(8);
    expect(extractMoveSegments([layer([prop({ blocksLight: true })])])).toHaveLength(0);
    expect(extractMoveSegments([layer([prop({ footprintRadius: 0.6 })])])).toHaveLength(0);
  });

  it('is placed blocking, its footprint at the size it is placed', () => {
    seedPack('test-pack', {
      pillar_2x2_A: { type: 'object', material: 'pillar', gridSize: '2x2', pieceType: 'object', variant: 'A', set: 'Rock', tags: ['blocking'], footprint: { radius: 0.8 } },
      crate_1x1_A: { type: 'object', material: 'crate', gridSize: '1x1', pieceType: 'object', variant: 'A', set: 'Rock', tags: [] },
    });
    expect(blockingFields('test-pack:pillar_2x2_A', 3)).toEqual({ blocksLight: true, footprintRadius: 1.2 });
    expect(blockingFields('test-pack:crate_1x1_A', 1)).toEqual({});
  });
});
