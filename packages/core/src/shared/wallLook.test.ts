import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { DungeonLayer, DungeonStyle, ShapeChild } from '../store/types';
import type { Room, WallSegment, WallType } from './types';
import { SEVEN_IDS, sevenRoomLayer } from '../testing/sevenRooms';
import {
  edgeStyles,
  floorWallSet,
  GROUP_WALL_TYPE,
  ringLook,
  ringOwner,
  ringStyles,
  setBandSetTest,
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
    expect(standaloneWallLook(wall, style)).toEqual({ setId: 'GG_Palisade', tint: '#ffffff', width: 0.5, corner: 'sharp' });
    // Corner style: the wall's own, else the layer's, else sharp.
    expect(standaloneWallLook(wall, { ...style, wallCornerStyle: 'rounded' }).corner).toBe('rounded');
    expect(standaloneWallLook({ ...wall, cornerStyle: 'sharp' }, { ...style, wallCornerStyle: 'rounded' }).corner).toBe('sharp');
    expect(standaloneWallLook({ ...wall, textureSetId: 'GG_Fieldstone', textureTint: '#b09878', width: 0.8 }, style)).toEqual({
      setId: 'GG_Fieldstone',
      tint: '#b09878',
      width: 0.8,
      corner: 'sharp',
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
    expect(ringLook(l, 0)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5, corner: 'sharp' });
    expect(ringLook(l, 1)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5, corner: 'sharp' });
  });

  it('gives each ring its own floor\'s pins when floors differ', () => {
    const pin = { wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#b09878' };
    const l = layer([shape('old', 0, pin), shape('new', 10)], [square(10), square(0)]);
    expect(ringLook(l, 0)).toEqual({ setId: 'GG_Palisade', tint: '#ffffff', width: 0.5, corner: 'sharp' });
    expect(ringLook(l, 1)).toEqual({ setId: 'GG_Fieldstone', tint: '#b09878', width: 0.5, corner: 'sharp' });
  });

  it('a pinned "no set" keeps a floor drawn bare without stones', () => {
    const l = layer([shape('bare', 0, { wallTextureSetId: '' }), shape('new', 10)], [square(0), square(10)]);
    expect(ringLook(l, 0).setId).toBeUndefined();
    expect(ringLook(l, 1).setId).toBe('GG_Palisade');
  });

  describe("a floor's own edge band", () => {
    const caveStyle = { ...style, wallTextureSetId: 'GG_Cave_Ink' } as DungeonStyle;
    const cave = (children: ShapeChild[], rings: [number, number][][]) => ({ ...layer(children, rings), style: caveStyle }) as DungeonLayer;
    const banded = (id: string, x: number, edgeBand: string | null | undefined): ShapeChild => ({ ...shape(id, x), edgeBand });
    beforeAll(() => setBandSetTest((id) => id.startsWith('GG_Cave')));
    afterAll(() => setBandSetTest(() => false));

    it("falls back to the layer's band when unset", () => {
      const l = cave([banded('a', 0, undefined), banded('b', 10, undefined)], [square(0), square(10)]);
      expect(ringLook(l, 0).setId).toBe('GG_Cave_Ink');
      expect(ringLook(l, 1).setId).toBe('GG_Cave_Ink');
    });

    it('is read first, over the layer', () => {
      const l = cave([banded('a', 0, 'GG_Cave_Moss'), banded('b', 10, undefined)], [square(0), square(10)]);
      expect(ringLook(l, 0).setId).toBe('GG_Cave_Moss');
      expect(ringLook(l, 1).setId).toBe('GG_Cave_Ink');
    });

    it('None takes the band off that floor alone, and never stone walls', () => {
      const l = cave([banded('a', 0, null), banded('b', 10, undefined)], [square(0), square(10)]);
      expect(ringLook(l, 0).setId).toBeUndefined();
      expect(ringLook(l, 1).setId).toBe('GG_Cave_Ink');
      const stone = layer([banded('a', 0, null)], [square(0)]);
      expect(ringLook(stone, 0).setId).toBe('GG_Palisade');
    });
  });

  it('a ring two floors were unioned into draws each edge with the floor it runs along', () => {
    const big = shape('big', 0, { wallTextureTint: '#111111' }, 8);
    const nub = { ...shape('nub', 7), contours: [[[7, 1], [9, 1], [9, 2], [7, 2]]] } as ShapeChild;
    // The union: the big square with the nub's far end sticking out on the right.
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
    // The ring as a whole still belongs to the floor most of it runs along...
    expect(ringOwner(ring, [nub, big])?.id).toBe('big');
    // ...but the nub's three edges draw as the nub does (it pins nothing: the layer's), the rest as the big floor.
    const edges = edgeStyles(layer([nub, big], [ring]))[0]!;
    expect(edges.map((s) => s.wallTextureTint)).toEqual(['#111111', '#111111', '#ffffff', '#ffffff', '#ffffff', '#111111', '#111111', '#111111']);
  });
});

describe("the seven-room cave's walls", () => {
  const IDS = SEVEN_IDS;
  beforeAll(() => setBandSetTest((id) => id === IDS.band || id === IDS.cave));
  afterAll(() => setBandSetTest(() => false));

  /** The cave's union as one ring, traced round the seven rectangles by hand. */
  const ring: [number, number][] = [
    [2, 3], [11, 3], [11, 6], [15, 6], [15, 2], [27, 2], [27, 13], [15, 13], [15, 8], [11, 8], [11, 12], [7, 12], [7, 18], [13, 18],
    [13, 21], [17, 21], [17, 17], [26, 17], [26, 26], [17, 26], [17, 23], [13, 23], [13, 27], [3, 27], [3, 18], [5, 18], [5, 12], [2, 12],
  ];
  const cave = (patch: Partial<DungeonLayer> = {}) => ({ ...sevenRoomLayer(), mergedFloor: [ring], ...patch }) as DungeonLayer;
  const passageSide = (a: [number, number], b: [number, number]) => (a[1] === 6 || a[1] === 8) && a[1] === b[1] && Math.min(a[0], b[0]) === 11 && Math.max(a[0], b[0]) === 15;

  it("takes the passage's own band on its two long sides, and only there", () => {
    const edges = edgeStyles(cave())[0]!;
    ring.forEach((a, e) => {
      const b = ring[(e + 1) % ring.length];
      expect(edges[e].wallTextureSetId, `${a} to ${b}`).toBe(passageSide(a, b) ? IDS.band : IDS.cave);
    });
  });

  it('takes its set when the passage has no band of its own, and none when its band is None on a band set', () => {
    const plain = cave();
    const withSet = { ...plain, children: plain.children.map((c) => (c.id === 'floor-2' ? { ...c, edgeBand: undefined } : c)) } as DungeonLayer;
    const sides = (l: DungeonLayer) => edgeStyles(l)[0]!.filter((_, e) => passageSide(ring[e], ring[(e + 1) % ring.length])).map((s) => s.wallTextureSetId);
    expect(sides(withSet)).toEqual([IDS.stone, IDS.stone]);
    const bandSet = { ...plain, children: plain.children.map((c) => (c.id === 'floor-2' ? { ...c, edgeBand: null, styleOverrides: { wallTextureSetId: IDS.cave } } : c)) } as DungeonLayer;
    expect(sides(bandSet)).toEqual(['', '']);
  });

  it('a wall look pinned on the room still wins over the floor', () => {
    // The passage's room, faced as a sync gives it.
    const rooms: Room[] = [{ id: 'r', name: 'Passage', anchor: [13, 7], face: [[11.4, 6], [14.4, 6], [14.4, 8], [11.4, 8]], look: { wallTextureSetId: 'Room_Set' } }];
    const edges = edgeStyles(cave({ rooms }))[0]!;
    const sides = edges.filter((_, e) => passageSide(ring[e], ring[(e + 1) % ring.length]));
    expect(sides.map((s) => s.wallTextureSetId)).toEqual(['Room_Set', 'Room_Set']);
    expect(edges[0].wallTextureSetId).toBe(IDS.cave);
  });

  it('draws every edge as its ring while no floor is pinned apart', () => {
    const l = cave();
    const same = { ...l, children: l.children.map((c) => (c.id === 'floor-2' ? { ...c, edgeBand: undefined, styleOverrides: { wallTextureSetId: IDS.cave } } : c)) } as DungeonLayer;
    expect(edgeStyles(same)).toEqual([null]);
  });

  it("reads a floor's own set as the renderer does", () => {
    const style = cave().style;
    const passage = cave().children.find((c) => c.id === 'floor-2') as ShapeChild;
    expect(floorWallSet(passage, style)).toBe(IDS.band);
    expect(floorWallSet({ ...passage, edgeBand: undefined }, style)).toBe(IDS.stone);
    expect(floorWallSet({ ...passage, edgeBand: undefined, styleOverrides: undefined }, style)).toBe(IDS.cave);
    expect(floorWallSet({ ...passage, edgeBand: null, styleOverrides: undefined }, style)).toBe('');
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
