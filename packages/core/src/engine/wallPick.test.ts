import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BAND_WALL_REACH,
  WALL_MIN_HIT_RADIUS,
  distanceToWall,
  getWallBounds,
  hitTestWalls,
  pickAllLayers,
  pickInLayer,
  wallReach,
  wallTouchesRect,
} from './hitTest';
import { createDungeonLayer } from '../store/factories';
import { useStore } from '../store/store';
import { resetAssetPackManager, seedCaveBandPack } from '../testing/seedCatalog';
import type { DungeonLayer } from '../store/types';
import type { AssetChild, DoorChild, ShapeChild, WallSegment } from '../shared/types';

function wall(id: string, points: [number, number][], extra: Partial<WallSegment> = {}): WallSegment {
  return { id, points, wallType: 'normal', direction: 'both', color: '#000000', roughness: 0, ...extra };
}

function floor(id: string, x0: number, y0: number, x1: number, y1: number): ShapeChild {
  return {
    id,
    name: 'Floor',
    childType: 'shape',
    shapeType: 'polygon',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

function door(id: string, position: [number, number], wallId: string): DoorChild {
  return {
    id,
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId,
    position,
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };
}

function prop(id: string, x: number, y: number): AssetChild {
  return {
    id,
    name: 'Crate',
    childType: 'asset',
    objectType: 'asset',
    assetId: 'crate',
    visible: true,
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

function layerWith(walls: WallSegment[], children: DungeonLayer['children'] = []): DungeonLayer {
  const l = createDungeonLayer('Test');
  // A plain stone set at width 0.5: half of it is 0.25, under the minimum radius.
  l.style = { ...l.style, wallTextureSetId: 'GG_Fieldstone', wallWidth: 0.5 };
  l.standaloneWalls = walls;
  l.children = children;
  return l;
}

describe('distanceToWall', () => {
  it('walks every segment of a polyline', () => {
    const w = wall('w', [[0, 0], [10, 0], [10, 10]]);
    expect(distanceToWall(w, [5, 1])).toBeCloseTo(1);
    expect(distanceToWall(w, [11, 5])).toBeCloseTo(1);
  });

  it('walks a loop closed: the repeated first point makes the last edge', () => {
    const w = wall('loop', [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    expect(distanceToWall(w, [0.5, 5])).toBeCloseTo(0.5);
  });
});

describe('hitTestWalls', () => {
  it('takes a click within the wall reach and refuses one past it', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])]);
    expect(wallReach(l.standaloneWalls[0], l)).toBe(WALL_MIN_HIT_RADIUS);
    expect(hitTestWalls(l, [5, 0.2])?.id).toBe('w');
    expect(hitTestWalls(l, [5, 0.6])).toBeNull();
  });

  it('reads the drawn width: the wall’s own pin, else the layer’s', () => {
    const l = layerWith([wall('thick', [[0, 0], [10, 0]], { width: 2 })]);
    expect(wallReach(l.standaloneWalls[0], l)).toBe(1);
    expect(hitTestWalls(l, [5, 0.9])?.id).toBe('thick');
    expect(hitTestWalls(l, [5, 1.2])).toBeNull();
  });

  it('adds a few screen pixels of slop at the given zoom', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])]);
    // 4px at 10px per cell is 0.4 cells on top of the 0.3 reach.
    expect(hitTestWalls(l, [5, 0.6], { zoom: 10 })?.id).toBe('w');
    expect(hitTestWalls(l, [5, 0.6], { zoom: 100 })).toBeNull();
  });

  it('picks the nearer of two overlapping walls', () => {
    const l = layerWith([wall('a', [[0, 0], [10, 0]]), wall('b', [[0, 0.5], [10, 0.5]])]);
    expect(hitTestWalls(l, [5, 0.1])?.id).toBe('a');
    expect(hitTestWalls(l, [5, 0.4])?.id).toBe('b');
  });

  it('has nothing to give while the layer’s walls are switched off', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])]);
    l.sublayerVisibility = { ...l.sublayerVisibility, walls: false };
    expect(hitTestWalls(l, [5, 0])).toBeNull();
  });

  it('skips a wall with fewer than two points', () => {
    const l = layerWith([wall('dot', [[5, 0]])]);
    expect(hitTestWalls(l, [5, 0])).toBeNull();
  });
});

describe('hitTestWalls on a cave kit', () => {
  beforeEach(() => {
    resetAssetPackManager();
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
  });
  afterEach(() => resetAssetPackManager());

  it('reaches as far as the rock rides, not the stone width', () => {
    const l = layerWith([wall('cave', [[0, 0], [10, 0]], { textureSetId: 'GG_Cave_Ink' })]);
    expect(wallReach(l.standaloneWalls[0], l)).toBe(BAND_WALL_REACH);
    expect(hitTestWalls(l, [5, 0.7])?.id).toBe('cave');
    expect(hitTestWalls(l, [5, 0.9])).toBeNull();
  });

  it('follows the layer’s set when the wall pins none', () => {
    const l = layerWith([wall('cave', [[0, 0], [10, 0]])]);
    l.style = { ...l.style, wallTextureSetId: 'GG_Cave_Ink' };
    expect(wallReach(l.standaloneWalls[0], l)).toBe(BAND_WALL_REACH);
  });
});

describe('pickInLayer', () => {
  it('a door on a wall wins over the wall', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])], [door('d', [5, 0], 'w')]);
    const hit = pickInLayer(l, [5, 0.1]);
    expect(hit?.kind).toBe('child');
    expect(hit?.id).toBe('d');
  });

  it('a prop on a wall wins over the wall', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])], [prop('p', 2, 0)]);
    expect(pickInLayer(l, [2, 0.1])?.id).toBe('p');
  });

  it('the wall wins over the floor it stands on', () => {
    const l = layerWith([wall('w', [[0, 5], [10, 5]])], [floor('f', 0, 0, 10, 10)]);
    const hit = pickInLayer(l, [5, 5.1]);
    expect(hit).toMatchObject({ kind: 'wall', id: 'w', layerId: l.id });
  });

  it('the floor still answers away from the wall', () => {
    const l = layerWith([wall('w', [[0, 5], [10, 5]])], [floor('f', 0, 0, 10, 10)]);
    expect(pickInLayer(l, [5, 2])).toMatchObject({ kind: 'child', id: 'f' });
  });

  it('nothing under the point is null', () => {
    const l = layerWith([wall('w', [[0, 0], [10, 0]])]);
    expect(pickInLayer(l, [5, 5])).toBeNull();
  });
});

describe('pickAllLayers', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('skips locked and hidden layers, walls with them', () => {
    const locked = layerWith([wall('locked', [[0, 0], [10, 0]])]);
    locked.locked = true;
    const hidden = layerWith([wall('hidden', [[0, 0], [10, 0]])]);
    hidden.visible = false;
    expect(pickAllLayers([locked, hidden], [5, 0])).toBeNull();
    const open = layerWith([wall('open', [[0, 0], [10, 0]])]);
    expect(pickAllLayers([open, locked, hidden], [5, 0])?.id).toBe('open');
  });

  it('a higher layer’s floor wins over a lower layer’s wall', () => {
    const below = layerWith([wall('w', [[0, 5], [10, 5]])]);
    const above = layerWith([], [floor('f', 0, 0, 10, 10)]);
    expect(pickAllLayers([below, above], [5, 5])?.id).toBe('f');
  });
});

describe('wallTouchesRect', () => {
  const box = { x: 4, y: 4, width: 2, height: 2 };

  it('a segment crossing the box touches it, with neither end inside', () => {
    expect(wallTouchesRect(wall('w', [[0, 5], [10, 5]]), box)).toBe(true);
  });

  it('a box inside a walled room does not touch the loop around it', () => {
    const loop = wall('loop', [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    expect(wallTouchesRect(loop, box, 0.3)).toBe(false);
  });

  it('the reach counts: a line just past the box edge is in its band', () => {
    const w = wall('w', [[0, 6.2], [10, 6.2]]);
    expect(wallTouchesRect(w, box)).toBe(false);
    expect(wallTouchesRect(w, box, 0.3)).toBe(true);
  });
});

describe('getWallBounds', () => {
  it('boxes the line, grown by the reach', () => {
    expect(getWallBounds(wall('w', [[1, 2], [5, 3]]), 0.5)).toEqual({ x: 0.5, y: 1.5, width: 5, height: 2 });
  });
});
