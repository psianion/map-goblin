import { describe, it, expect } from 'vitest';
import type { BackgroundLayer, DungeonLayer, ImageLayer } from '@/store/types';
import { checkRename, gridColourLayerIds, sheetSections, showRows } from './layerSheetModel';

const dungeon = (over: Partial<DungeonLayer> = {}): DungeonLayer =>
  ({
    id: 'd1',
    name: 'Layer 1',
    type: 'dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children: [],
    standaloneWalls: [],
    mergedFloor: null,
    sublayerVisibility: { floor: true, grid: true, walls: true },
    style: { showEdgeTransitions: false, edgeTransitionWidth: 0.5 },
    ...over,
  }) as DungeonLayer;

const background = { id: 'bg', name: 'Background', type: 'background', opacity: 1 } as BackgroundLayer;

describe('sheetSections', () => {
  it('gives a dungeon layer every group, the layer actions last', () => {
    expect(sheetSections(dungeon())).toEqual(['name', 'opacity', 'show', 'edges', 'actions']);
  });
  it('gives a background layer its name, colour and texture, and opacity; no sublayers', () => {
    expect(sheetSections(background)).toEqual(['name', 'background', 'opacity']);
  });
  it('gives a trace the rows of its own sheet', () => {
    const trace = { id: 't', name: 'Trace', type: 'image', opacity: 0.4, imageKey: 'k', fileName: 'a.png', fit: 'map' } as ImageLayer;
    expect(sheetSections(trace)).toEqual(['trace']);
  });
  it('gives terrain its own group', () => {
    expect(sheetSections('terrain')).toEqual(['terrain']);
  });
});

describe('showRows', () => {
  it('lists the sublayers a layer has, in order', () => {
    expect(showRows(dungeon()).map((r) => r.label)).toEqual(['Floor', 'Grid', 'Walls and doors', 'Labels', 'Zones']);
  });
  it('skips sublayers the layer does not carry, but always offers Labels and Zones', () => {
    const l = dungeon({ sublayerVisibility: { floor: true } as DungeonLayer['sublayerVisibility'] });
    expect(showRows(l).map((r) => r.key)).toEqual(['floor', 'labels', 'zones']);
    expect(showRows(background)).toEqual([]);
  });
});

describe('checkRename', () => {
  it('trims and commits a new name', () => {
    expect(checkRename('  Crypt ', 'Hall')).toEqual({ kind: 'commit', name: 'Crypt' });
  });
  it('refuses blank and ignores the same name', () => {
    expect(checkRename('   ', 'Hall')).toEqual({ kind: 'empty' });
    expect(checkRename('Hall ', 'Hall')).toEqual({ kind: 'unchanged' });
  });
});

describe('gridColourLayerIds', () => {
  const pic = { id: 'img', childType: 'asset', objectType: 'image', visible: true } as unknown as DungeonLayer['children'][number];
  const prop = { id: 'p', childType: 'asset', objectType: 'asset', visible: true } as unknown as DungeonLayer['children'][number];
  const tracing = dungeon({ id: 'trace', levelId: 'l1' });
  const battlemap = dungeon({ id: 'bm', name: 'Battlemap', levelId: 'l1', children: [pic] });
  const props = dungeon({ id: 'props', levelId: 'l1', children: [prop] });
  const below = dungeon({ id: 'below', levelId: 'l2', children: [pic] });
  const layers = [battlemap, tracing, props, below, background];

  it('is the active layer, then the picture layers on its level, so the grid over a battlemap follows the swatch', () => {
    expect(gridColourLayerIds(layers, tracing)).toEqual(['trace', 'bm']);
    expect(gridColourLayerIds(layers, battlemap)).toEqual(['bm']);
  });

  it('is nothing without an active dungeon layer', () => {
    expect(gridColourLayerIds(layers, null)).toEqual([]);
    expect(gridColourLayerIds(layers, background)).toEqual([]);
  });
});
