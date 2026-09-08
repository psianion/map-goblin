// The client's half of §2: that the sweep answers the same three questions the server's does
// — a wall stops it, a shut door stops it, an open one lets it through — and that the memo
// only recomputes what actually moved.
//
// The fixture is the server's, deliberately: two halls either side of one long wall with a
// two-cell door in it (`session/testdata/vision-two-rooms.mapbuilder`, and
// `session/server/src/fog/vision-mode.test.ts` asks the same geometry the same questions).
// The two sweeps have to agree, so they are checked against the same shape.

import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { DoorChild, WallSegment } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { Token } from '@dnd/mechanics/tokens';
import { createSightCache, sighted } from './visionSight';

const SPINE = 11;

const wall: WallSegment = {
  id: 'wall-mid',
  points: [
    [SPINE, -20],
    [SPINE, 20],
  ],
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  width: 0.5,
  roughness: 0,
} as WallSegment;

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'door-mid',
    name: 'Middle Door',
    childType: 'door',
    visible: true,
    wallId: 'wall-mid',
    position: [SPINE, 5],
    angle: 0,
    width: 2,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: 'west',
    roomB: 'east',
    ...over,
  }) as DoorChild;

/** A fresh layers array every call — core replaces its own on every write, and so must this. */
const layersWith = (doors: DoorChild[]): Layer[] => [
  {
    id: 'l1',
    type: 'dungeon',
    visible: true,
    children: doors,
    standaloneWalls: [wall],
    mergedFloor: null,
    rooms: [],
  } as unknown as Layer,
];

const scout = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Scout',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: { range: 8, angle: 360, visionMode: 'normal' },
  light: null,
  defId: null,
  x: 5,
  y: 5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p1',
  ...over,
});

const sees = (polygons: readonly [number, number][][], point: [number, number]): boolean =>
  polygons.some((polygon) => pointInPolygon(point, polygon));

describe('the party sweep the mask is cut to (S3 P2 §2)', () => {
  it('reaches across its own hall and stops on the wall', () => {
    const sight = createSightCache().partySight(layersWith([door()]), [scout()]);
    expect(sight).toHaveLength(1);
    expect(sees(sight, [9.5, 5])).toBe(true);
    expect(sees(sight, [12.5, 5])).toBe(false);
  });

  it('lets the same sight through the moment the door is open — and only through the gap', () => {
    const sight = createSightCache().partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(sees(sight, [12.5, 5])).toBe(true);
    // The doorway is two cells of wall, not a hole in the whole of it.
    expect(sees(sight, [12.5, 2.5])).toBe(false);
  });

  it('treats a secret door the party has not found as the wall it is disguised as', () => {
    // A player's copy of the document simply has no child for it (D4), so the wall is never
    // split — which is the server's answer for the same party, arrived at the same way.
    const unfound = createSightCache().partySight(layersWith([]), [scout({ y: 5 })]);
    const found = createSightCache().partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(sees(unfound, [12.5, 5])).toBe(false);
    expect(sees(found, [12.5, 5])).toBe(true);
  });

  it('sweeps against mergedFloor too, sharing the same rings the lighting pass resolves', () => {
    // Core unions a room's floor shapes into `mergedFloor`, and `resolveWalls` promotes every
    // one of that ring's edges to a light-blocking wall — same as any standalone wall. This
    // pass used to sweep a copy with `mergedFloor` nulled out, to match the server's sweep over
    // the persisted map (where the field ships null, never saved). The server now heals that
    // null at scene-index time (session/server/src/fog/sceneMap.ts), so both sides can agree on
    // the real union instead of both ignoring it.
    const boxed = layersWith([door({ state: 'open' })]);
    (boxed[0] as unknown as { mergedFloor: unknown }).mergedFloor = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ];
    // The ring's own east edge (x=10) occludes everywhere the doorway is not: level with the
    // door it is part of that doorway and opens with it, a cell and a half above it is floor
    // boundary and stops the sweep exactly as the wall behind it does.
    //
    // This row used to assert the opposite at y=5 — that an open door on `wall-mid` left the
    // ring edge a cell in front of it solid, boxing the party inside their own floor. That is
    // the bug `toOcclusionDoors`' aperture rule fixes: a doorway is one gap through everything
    // standing in it, and a DM who opens a door on a map whose floor stops short of the wall
    // must not be opening a door onto a second wall nobody can see.
    expect(sees(createSightCache().partySight(boxed, [scout()]), [12.5, 5])).toBe(true);
    expect(sees(createSightCache().partySight(boxed, [scout()]), [12.5, 2.5])).toBe(false);
    // …and still sees to its own edge, inside the ring.
    expect(sees(createSightCache().partySight(boxed, [scout()]), [9.5, 5])).toBe(true);
  });

  it('keeps a mergedFloor edge solid where no door pierces it', () => {
    // The other half of the aperture rule, and the one that keeps it honest: the same ring,
    // the same open door, and a sweep taken from level with the ring's edge but well clear of
    // the doorway. Nothing is opened here, so nothing gets through — a rule that widened a
    // door into a hole in the whole ring would read `true` on both of these.
    const boxed = layersWith([door({ state: 'open' })]);
    (boxed[0] as unknown as { mergedFloor: unknown }).mergedFloor = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ];
    const low = createSightCache().partySight(boxed, [scout({ y: 1 })]);
    expect(sees(low, [9.5, 1])).toBe(true);
    expect(sees(low, [12.5, 1])).toBe(false);
  });

  it('draws through claimed, unhidden, sighted eyes and no others', () => {
    const tokens = [
      scout({ id: 't1' }),
      scout({ id: 't2', ownerId: null }), // the DM's scenery
      scout({ id: 't3', hidden: true }),
      scout({ id: 't4', sight: null }),
      // Plain sight, no darkvision: still an eye — it sees whatever is lit.
      scout({ id: 't5', sight: { range: 0, angle: 360, visionMode: 'normal' } }),
    ];
    expect(sighted(tokens).map((t) => t.id)).toEqual(['t1', 't5']);
  });

  it('sweeps a plain-sighted torch-bearer to its torch under the range limit', () => {
    const torch = scout({
      sight: { range: 0, angle: 360, visionMode: 'normal' },
      light: { dim: 4, bright: 2, color: '#ffdd88', angle: 360 },
    });
    const sight = createSightCache().partySight(layersWith([]), [torch], true);
    // Three cells out is inside the glow; eight is past it — the walls never entered into it.
    expect(sees(sight, [8, 5])).toBe(true);
    expect(sees(sight, [5, 13])).toBe(false);
    // The same eye with nothing in hand reaches nowhere under the limit.
    const dark = createSightCache().partySight(layersWith([]), [scout({ ...torch, light: null })], true);
    expect(sees(dark, [6, 5])).toBe(false);
  });

  /**
   * S3 P5 — the same filter with the seed narrowed to one seat, which is the whole of the
   * client's individual-share change. Written so party share would answer differently: the
   * other player's token is one this seat legitimately *holds* (it walked into their sight),
   * and drawing the mask through its eyes too would hand back the party view.
   */
  it('draws through this seat’s own eyes alone when the share is individual', () => {
    const mine = (t: Token) => t.ownerId === 'p1';
    // The edges are symmetric, the way `set-sight-link` writes them on both ends.
    const tokens = [
      scout({ id: 'mine', sharesSightWith: ['familiar'] }),
      scout({ id: 'familiar', ownerId: null, sharesSightWith: ['mine'] }),
      scout({ id: 'theirs', ownerId: 'p2', sharesSightWith: ['their-familiar'] }),
      scout({ id: 'their-familiar', ownerId: null, sharesSightWith: ['theirs'] }),
    ];
    // Own claimed token plus the closure over the DM's links, and nothing of the other seat's.
    expect(sighted(tokens, mine).map((t) => t.id).sort()).toEqual(['familiar', 'mine']);
    // …and with no seed at all it is the party: every claimed token and their familiars.
    expect(sighted(tokens).map((t) => t.id).sort()).toEqual([
      'familiar',
      'mine',
      'their-familiar',
      'theirs',
    ]);
  });
});

describe('the memo that keeps a still party from paying twice', () => {
  it('sweeps once for a token that has not moved, and again when it does', () => {
    const cache = createSightCache();
    const layers = layersWith([door()]);

    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(1);
    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(1);

    cache.partySight(layers, [scout({ x: 6 })]);
    expect(cache.sweeps()).toBe(2);
    // …and back where it started is a cache hit, not a third sweep.
    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(2);
  });

  it('recomputes an unmoved token when the door under its sight swings', () => {
    const cache = createSightCache();
    const before = cache.partySight(layersWith([door()]), [scout()]);
    expect(cache.sweeps()).toBe(1);

    // The swing is a write to core's layers (`syncDoorsToLighting`), which is a new array —
    // and that array *is* the dirty flag. Nothing calls an invalidate.
    const after = cache.partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(cache.sweeps()).toBe(2);
    expect(sees(before, [12.5, 5])).toBe(false);
    expect(sees(after, [12.5, 5])).toBe(true);
  });

  it('costs one sweep per pair of eyes and nothing for a party of none', () => {
    const cache = createSightCache();
    const layers = layersWith([door()]);
    expect(cache.partySight(layers, [])).toEqual([]);
    expect(cache.sweeps()).toBe(0);

    expect(cache.partySight(layers, [scout({ id: 't1' }), scout({ id: 't2', x: 3 })])).toHaveLength(2);
    expect(cache.sweeps()).toBe(2);
  });
});

// ── O1/O2 on the table's own occluders ──────────────────────────────────────
//
// The mask is cut to the sweep this cache takes, and it takes it against the layers this seat
// holds — so a drawn room's boundary has to stop it here exactly as it stops the referee's
// (session/server/src/fog/connectors.test.ts asks the same geometry the same questions). The
// promotion is shared code and is proved in core; what is only true here is that a player's
// own copy carries the contours and blobs to do it with.

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const roomChild = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  ({
    id,
    name: id,
    childType: 'room',
    visible: true,
    contours: [rect(x0, y0, x1, y1)],
  }) as unknown as DoorChild;

const jointChild = (over: Record<string, unknown> = {}) =>
  ({
    id: 'joint',
    name: 'the neck',
    childType: 'connector',
    visible: true,
    contours: [rect(9, 4, 13, 6)],
    kind: 'door',
    state: 'closed',
    isSecret: false,
    ...over,
  }) as unknown as DoorChild;

/** The two drawn chambers, with whatever joint the row is about. A fresh array every call. */
const drawnLayers = (joint: DoorChild | null): Layer[] => [
  {
    id: `drawn-${Math.random()}`,
    type: 'dungeon',
    visible: true,
    children: [
      roomChild('hall', 0, 0, 10, 10),
      roomChild('crypt', 12, 0, 22, 10),
      ...(joint ? [joint] : []),
    ],
    standaloneWalls: [],
    mergedFloor: null,
    rooms: [],
  } as unknown as Layer,
];

describe('the sweep against rooms the DM drew (O1/O2)', () => {
  const look = (joint: DoorChild | null) =>
    createSightCache().partySight(drawnLayers(joint), [scout()]);

  it('stops on a drawn boundary with no joint through it', () => {
    const sight = look(null);
    expect(sees(sight, [8, 5])).toBe(true);
    expect(sees(sight, [17, 5])).toBe(false);
  });

  it('passes an open joint, and only across the doorway it cuts', () => {
    const sight = look(jointChild({ state: 'open' }));
    expect(sees(sight, [17, 5])).toBe(true);
    expect(sees(sight, [17, 1])).toBe(false);
  });

  it('stops at a shut one, locked or merely closed', () => {
    expect(sees(look(jointChild({ state: 'closed' })), [17, 5])).toBe(false);
    expect(sees(look(jointChild({ state: 'locked' })), [17, 5])).toBe(false);
  });

  it('stands an arch open whatever the map file authored on it', () => {
    expect(sees(look(jointChild({ kind: 'arch', state: 'closed' })), [17, 5])).toBe(true);
  });
});
