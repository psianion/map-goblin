import { describe, it, expect } from 'vitest';
import type { BackgroundLayer, DungeonLayer } from '@/store/types';
import { checkRename, sheetSections, showRows } from './layerSheetModel';

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
  it('gives a dungeon layer every group', () => {
    expect(sheetSections(dungeon())).toEqual(['name', 'opacity', 'show', 'edges']);
  });
  it('gives a background layer name and opacity only, since it has no sublayers', () => {
    expect(sheetSections(background)).toEqual(['name', 'opacity']);
  });
  it('gives terrain its own group', () => {
    expect(sheetSections('terrain')).toEqual(['terrain']);
  });
});

describe('showRows', () => {
  it('lists the sublayers a layer has, in order', () => {
    expect(showRows(dungeon()).map((r) => r.label)).toEqual(['Floor', 'Grid', 'Walls and doors']);
  });
  it('skips sublayers the layer does not carry', () => {
    const l = dungeon({ sublayerVisibility: { floor: true } as DungeonLayer['sublayerVisibility'] });
    expect(showRows(l).map((r) => r.key)).toEqual(['floor']);
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
