import { describe, it, expect } from 'vitest';
import type { DungeonLayer, DungeonStyle, ShapeChild } from '../store/types';
import type { WallSegment, WallType } from './types';
import {
  GROUP_WALL_TYPE,
  ringLook,
  ringOwner,
  ringStyles,
  standaloneWallLook,
  styleValueOrDefault,
  wallTypeGroup,
  wallWidthOf,
} from './wallLook';

const style = {
  floorColor: '#ffffff',
  wallColor: '#000000',
  wallWidth: 0.5,
  lineWidth: 0.04,
  edgeTransitionWidth: 0.5,
  showEdgeTransitions: true,
  wallTextureSetId: 'GG_Palisade',
  wallTextureTint: '#ffffff',
} as DungeonStyle;

const square = (x: number, size = 4): [number, number][] => [
  [x, 0],
  [x + size, 0],
  [x + size, size],
  [x, size],
];

const shape = (id: string, x: number, styleOverrides?: Partial<DungeonStyle>, size = 4): ShapeChild =>
  ({
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [square(x, size)],
    styleOverrides,
  }) as ShapeChild;

const layer = (children: ShapeChild[], rings: [number, number][][]): DungeonLayer =>
  ({
    id: `l-${Math.random()}`,
    type: 'dungeon',
    children,
    standaloneWalls: [],
    mergedFloor: rings,
    style,
  }) as unknown as DungeonLayer;

describe('wall widths', () => {
  it('a wall without its own width takes the layer width', () => {
    expect(wallWidthOf({}, 0.7)).toBe(0.7);
    expect(wallWidthOf({ width: 0.3 }, 0.7)).toBe(0.3);
    // A zero width never drew anything; it reads as unset, as the renderer always did.
    expect(wallWidthOf({ width: 0 }, 0.7)).toBe(0.7);
  });

  it('a wall look is each of its pins over the layer', () => {
    const wall = { id: 'w', points: [], wallType: 'normal' } as unknown as WallSegment;
    expect(standaloneWallLook(wall, style)).toEqual({ setId: 'GG_Palisade', tint: '#ffffff', width: 0.5 });
    expect(standaloneWallLook({ ...wall, textureSetId: 'GG_Fieldstone', textureTint: '#b09878', width: 0.8 }, style)).toEqual({
      setId: 'GG_Fieldstone',
      tint: '#b09878',
      width: 0.8,
    });
    // An empty set pin is "no stones", not "follow the layer".
    expect(standaloneWallLook({ ...wall, textureSetId: '' }, style).setId).toBeUndefined();
  });

  it('a style key the layer never set reads as the renderer fallback', () => {
    expect(styleValueOrDefault(style, 'floorBleed')).toBe(0);
    expect(styleValueOrDefault({ ...style, floorBleed: 0.45 }, 'floorBleed')).toBe(0.45);
    expect(styleValueOrDefault({ ...style, wallTextureSetId: undefined }, 'wallTextureSetId')).toBe('');
  });
});

describe('floor outline look', () => {
  it('follows the layer while no floor carries an outline pin', () => {
    const l = layer([shape('a', 0, { floorColor: '#123456' })], [square(0)]);
    expect(ringStyles(l)[0]).toBe(l.style);
  });

  it('takes every floor\'s shared pin when they agree', () => {
    const pin = { wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#b09878', wallWidth: 0.5 };
    const l = layer([shape('a', 0, pin), shape('b', 10, pin)], [square(0), square(10)]);
    expect(ringLook(l, 0)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5 });
    expect(ringLook(l, 1)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5 });
  });

  it('gives each ring its own floor\'s pins when floors differ', () => {
    const pin = { wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#b09878' };
    const l = layer([shape('old', 0, pin), shape('new', 10)], [square(10), square(0)]);
    expect(ringLook(l, 0)).toEqual({ setId: 'GG_Palisade', tint: '#ffffff', width: 0.5 });
    expect(ringLook(l, 1)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5 });
  });

  it('a pinned "no set" keeps a floor drawn bare without stones', () => {
    const l = layer([shape('bare', 0, { wallTextureSetId: '' }), shape('new', 10)], [square(0), square(10)]);
    expect(ringLook(l, 0).setId).toBeUndefined();
    expect(ringLook(l, 1).setId).toBe('GG_Palisade');
  });

  it('a ring two floors were unioned into belongs to the one most of it runs along', () => {
    const big = shape('big', 0, { wallTextureTint: '#111111' }, 8);
    const nub = shape('nub', 7, undefined, 2);
    // The union: the big square with the nub's far edge sticking out on the right.
    const ring: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 1],
      [9, 1],
      [9, 2],
      [8, 2],
      [8, 8],
      [0, 8],
    ];
    expect(ringOwner(ring, [nub, big])?.id).toBe('big');
  });
});

describe('wall type groups', () => {
  it('sorts the five stored types by what they block', () => {
    const groups = (['normal', 'ethereal', 'window', 'terrain', 'invisible'] as WallType[]).map(wallTypeGroup);
    expect(groups).toEqual(['solid', 'solid', 'window', 'open', 'open']);
  });

  it('writes one stored type per group, each landing back in its group', () => {
    expect(GROUP_WALL_TYPE).toEqual({ solid: 'normal', window: 'window', open: 'invisible' });
    for (const [g, t] of Object.entries(GROUP_WALL_TYPE)) expect(wallTypeGroup(t)).toBe(g);
  });
});
